-- invest-sim v2 migration
-- Run after 001 schema. Adds: symbols metadata, portfolio snapshots,
-- watchlists, profile avatars/bios, time-windowed leaderboards, daily cron.

-- ---------------------------------------------------------------------------
-- 1. symbols metadata cache
-- ---------------------------------------------------------------------------
create table if not exists public.symbols (
  kind         text not null check (kind in ('stock','crypto')),
  symbol       text not null,
  name         text,
  logo_url     text,
  exchange     text,
  industry     text,
  market_cap   numeric,
  description  text,
  updated_at   timestamptz not null default now(),
  primary key (kind, symbol)
);
alter table public.symbols enable row level security;
drop policy if exists symbols_read on public.symbols;
create policy symbols_read on public.symbols for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 2. portfolio snapshots (time series for charting + daily/weekly boards)
-- ---------------------------------------------------------------------------
create table if not exists public.portfolio_snapshots (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ts          timestamptz not null default now(),
  total_usd   numeric(14,2) not null,
  cash_usd    numeric(14,2) not null,
  primary key (user_id, ts)
);
create index if not exists portfolio_snapshots_ts_idx on public.portfolio_snapshots (ts desc);

alter table public.portfolio_snapshots enable row level security;
drop policy if exists snapshots_read on public.portfolio_snapshots;
create policy snapshots_read on public.portfolio_snapshots
  for select using (auth.role() = 'authenticated');

-- Helper: compute current total value for a user from cash + positions × cached prices.
create or replace function public.compute_user_total(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(pr.cash_usd, 0)
    + coalesce((select sum(pos.qty * pc.price_usd)
                from positions pos
                join prices_cache pc on pc.kind = pos.kind and pc.symbol = pos.symbol
                where pos.user_id = p_user), 0)
  from profiles pr where pr.id = p_user
$$;

-- Trigger: after each trade, snapshot the trader's total.
create or replace function public.snapshot_on_trade() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cash  numeric;
  v_total numeric;
begin
  select cash_usd into v_cash from profiles where id = new.user_id;
  v_total := compute_user_total(new.user_id);
  insert into portfolio_snapshots(user_id, ts, total_usd, cash_usd)
    values (new.user_id, now(), v_total, v_cash)
    on conflict (user_id, ts) do nothing;
  return new;
end
$$;

drop trigger if exists trades_snapshot_trigger on public.trades;
create trigger trades_snapshot_trigger
  after insert on public.trades
  for each row execute function public.snapshot_on_trade();

-- Daily cron: snapshot every user at UTC midnight. Uses pg_cron.
-- pg_cron must be enabled in the Supabase dashboard under Database → Extensions.

create or replace function public.snapshot_all_users() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into portfolio_snapshots(user_id, ts, total_usd, cash_usd)
    select id, now(), compute_user_total(id), cash_usd from profiles
    on conflict (user_id, ts) do nothing;
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'invest_sim_daily_snapshot') then
      perform cron.unschedule('invest_sim_daily_snapshot');
    end if;
    perform cron.schedule('invest_sim_daily_snapshot', '0 0 * * *',
      'select public.snapshot_all_users();');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. time-windowed leaderboards
-- ---------------------------------------------------------------------------
-- All-time: current totals (existing leaderboard view rewritten to be consistent).
create or replace view public.leaderboard as
  select p.username, compute_user_total(p.id) as total_usd
  from profiles p
  order by total_usd desc;

-- Window helper: returns (username, start_total, end_total, pnl_usd, pnl_pct)
-- computed from the earliest snapshot inside the window and the latest at/after window start.
create or replace function public.leaderboard_window(p_since timestamptz)
returns table (username text, start_total numeric, end_total numeric, pnl_usd numeric, pnl_pct numeric)
language sql stable security definer set search_path = public as $$
  with earliest as (
    select distinct on (user_id) user_id, total_usd
    from portfolio_snapshots
    where ts >= p_since
    order by user_id, ts asc
  ),
  current_totals as (
    select id as user_id, compute_user_total(id) as total_usd from profiles
  )
  select
    p.username,
    coalesce(e.total_usd, 100000)::numeric as start_total,
    c.total_usd::numeric                   as end_total,
    (c.total_usd - coalesce(e.total_usd, 100000))::numeric as pnl_usd,
    case when coalesce(e.total_usd, 100000) = 0 then 0
         else ((c.total_usd - coalesce(e.total_usd, 100000)) / coalesce(e.total_usd, 100000) * 100)::numeric
    end as pnl_pct
  from profiles p
  join current_totals c on c.user_id = p.id
  left join earliest e on e.user_id = p.id
  order by pnl_pct desc
$$;

grant execute on function public.leaderboard_window(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. watchlists
-- ---------------------------------------------------------------------------
create table if not exists public.watchlists (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('stock','crypto')),
  symbol     text not null,
  added_at   timestamptz not null default now(),
  primary key (user_id, kind, symbol)
);
alter table public.watchlists enable row level security;
drop policy if exists watchlists_rw on public.watchlists;
create policy watchlists_rw on public.watchlists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. profile extras: avatar_url, bio
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio        text;

-- ---------------------------------------------------------------------------
-- 6. slippage inside execute_trade
-- ---------------------------------------------------------------------------
-- Apply ±0.2% randomization on fill price so buys/sells don't always hit mid.
-- Rewriting the function to include this tweak.
create or replace function public.execute_trade(
  p_kind text, p_symbol text, p_side text, p_qty numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_base_price numeric;
  v_price numeric;
  v_cash numeric;
  v_cost numeric;
  v_pos_qty numeric;
  v_pos_avg numeric;
  v_new_qty numeric;
  v_slip numeric;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_kind not in ('stock','crypto') then raise exception 'bad kind'; end if;
  if p_side not in ('buy','sell')     then raise exception 'bad side'; end if;
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;

  select price_usd into v_base_price
    from prices_cache where kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
  if v_base_price is null then raise exception 'no price cached for %/% — try again in a minute', p_kind, p_symbol; end if;

  -- Buys fill slightly above mid, sells slightly below, ±0.2% band.
  v_slip := ((random() * 0.002) + 0.0005);
  v_price := case when p_side = 'buy'
                  then v_base_price * (1 + v_slip)
                  else v_base_price * (1 - v_slip) end;
  v_cost := v_price * p_qty;

  select cash_usd into v_cash from profiles where id = v_user for update;
  select qty, avg_cost_usd into v_pos_qty, v_pos_avg
    from positions where user_id = v_user and kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);

  if p_side = 'buy' then
    if v_cash < v_cost then raise exception 'insufficient cash'; end if;
    update profiles set cash_usd = cash_usd - v_cost where id = v_user;
    if v_pos_qty is null then
      insert into positions(user_id, kind, symbol, qty, avg_cost_usd)
        values (v_user, p_kind, upper_symbol(p_kind, p_symbol), p_qty, v_price);
    else
      v_new_qty := v_pos_qty + p_qty;
      update positions
        set qty = v_new_qty,
            avg_cost_usd = ((v_pos_qty * v_pos_avg) + v_cost) / v_new_qty
        where user_id = v_user and kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
    end if;
  else
    if v_pos_qty is null or v_pos_qty < p_qty then raise exception 'insufficient position'; end if;
    update profiles set cash_usd = cash_usd + v_cost where id = v_user;
    v_new_qty := v_pos_qty - p_qty;
    if v_new_qty = 0 then
      delete from positions where user_id = v_user and kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
    else
      update positions set qty = v_new_qty
        where user_id = v_user and kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
    end if;
  end if;

  insert into trades(user_id, kind, symbol, side, qty, price_usd)
    values (v_user, p_kind, upper_symbol(p_kind, p_symbol), p_side, p_qty, v_price);

  return jsonb_build_object('price', v_price, 'base_price', v_base_price, 'cost', v_cost, 'slippage_bps', v_slip * 10000);
end
$$;

-- ---------------------------------------------------------------------------
-- 7. "Buy $X worth" RPC — computes qty from cash amount and calls execute_trade.
-- ---------------------------------------------------------------------------
create or replace function public.execute_trade_cash(
  p_kind text, p_symbol text, p_side text, p_cash_usd numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_base_price numeric;
  v_qty numeric;
begin
  if p_cash_usd <= 0 then raise exception 'amount must be positive'; end if;
  select price_usd into v_base_price
    from prices_cache where kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
  if v_base_price is null then raise exception 'no price cached for %/%', p_kind, p_symbol; end if;
  -- approximate qty from base price; actual fill price includes slippage.
  v_qty := p_cash_usd / v_base_price;
  return execute_trade(p_kind, p_symbol, p_side, v_qty);
end
$$;

-- ---------------------------------------------------------------------------
-- 8. public recent trades view (last 50, with username joined)
-- ---------------------------------------------------------------------------
create or replace view public.recent_trades as
  select t.id, t.kind, t.symbol, t.side, t.qty, t.price_usd, t.ts,
         p.username
  from trades t
  join profiles p on p.id = t.user_id
  order by t.ts desc
  limit 50;

grant select on public.recent_trades to authenticated;

-- ---------------------------------------------------------------------------
-- 9. top movers view (biggest 24h % gainers/losers amongst tracked symbols)
-- Requires historical prices per symbol — simplest: keep a tiny rolling history
-- in prices_cache via a new column. For v2 we just surface current price +
-- fake a prev via last-known cached timestamp. Real 24h % needs more; leaving
-- as a TODO. Expose a view so the client can still render "popular" symbols.
-- ---------------------------------------------------------------------------
create or replace view public.popular_symbols as
  select s.kind, s.symbol, s.name, s.logo_url, pc.price_usd,
         count(distinct pos.user_id) as holders
  from symbols s
  join prices_cache pc on pc.kind = s.kind and pc.symbol = s.symbol
  left join positions pos on pos.kind = s.kind and pos.symbol = s.symbol
  group by s.kind, s.symbol, s.name, s.logo_url, pc.price_usd
  order by holders desc, s.symbol
  limit 20;

grant select on public.popular_symbols to authenticated;
