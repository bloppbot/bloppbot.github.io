-- invest-sim schema for Supabase
-- Run in Supabase SQL editor after project is created.

-- Users are tracked via auth.users (Supabase Auth). We map a chosen username
-- to an internal dummy email `<username>@bloppbot.local` at signup time.
-- A profile row exists per user to hold cash + username.

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  cash_usd     numeric(14,2) not null default 100000,
  created_at   timestamptz not null default now()
);

-- A position is a non-zero holding for a given (user, symbol, kind).
create table if not exists public.positions (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('stock','crypto')),
  symbol       text not null,
  qty          numeric(20,8) not null,
  avg_cost_usd numeric(14,4) not null,
  primary key (user_id, kind, symbol)
);

-- Append-only trade log.
create table if not exists public.trades (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('stock','crypto')),
  symbol       text not null,
  side         text not null check (side in ('buy','sell')),
  qty          numeric(20,8) not null check (qty > 0),
  price_usd    numeric(14,4) not null check (price_usd > 0),
  ts           timestamptz not null default now()
);
create index if not exists trades_user_ts_idx on public.trades (user_id, ts desc);

-- Price cache filled by the scheduled edge function.
create table if not exists public.prices_cache (
  kind         text not null check (kind in ('stock','crypto')),
  symbol       text not null,
  price_usd    numeric(14,4) not null,
  updated_at   timestamptz not null default now(),
  primary key (kind, symbol)
);

-- RLS: users can see + modify only their own rows.
alter table public.profiles   enable row level security;
alter table public.positions  enable row level security;
alter table public.trades     enable row level security;
alter table public.prices_cache enable row level security;

-- Profiles: anyone logged in can read all (for leaderboard), only owner can update.
drop policy if exists profiles_read    on public.profiles;
drop policy if exists profiles_update  on public.profiles;
drop policy if exists profiles_insert  on public.profiles;
create policy profiles_read   on public.profiles for select using (auth.role() = 'authenticated');
create policy profiles_update on public.profiles for update using (auth.uid() = id);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);

-- Positions: owner-only (leaderboard joins via a security-definer function).
drop policy if exists positions_rw on public.positions;
create policy positions_rw on public.positions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trades: owner-only insert/select.
drop policy if exists trades_rw on public.trades;
create policy trades_rw on public.trades for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Prices: everyone authenticated can read. Writes only via service role (edge function).
drop policy if exists prices_read on public.prices_cache;
create policy prices_read on public.prices_cache for select using (auth.role() = 'authenticated');

-- Atomic trade: runs under SECURITY DEFINER so we can update cash + position + log
-- in a single transaction while still enforcing auth.uid() = user_id inside.
create or replace function public.execute_trade(
  p_kind text, p_symbol text, p_side text, p_qty numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_price numeric;
  v_cash numeric;
  v_cost numeric;
  v_pos_qty numeric;
  v_pos_avg numeric;
  v_new_qty numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('stock','crypto') then raise exception 'bad kind'; end if;
  if p_side not in ('buy','sell')     then raise exception 'bad side'; end if;
  if p_qty <= 0 then raise exception 'qty must be positive'; end if;

  select price_usd into v_price
    from prices_cache where kind = p_kind and symbol = upper_symbol(p_kind, p_symbol);
  if v_price is null then raise exception 'no price cached for %/% — try again in a minute', p_kind, p_symbol; end if;

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
  else -- sell
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

  return jsonb_build_object('price', v_price, 'cost', v_cost);
end
$$;

-- Normalize symbols: stocks uppercase (AAPL), crypto lowercase (bitcoin) per CoinGecko ids.
create or replace function public.upper_symbol(p_kind text, p_symbol text) returns text
language sql immutable as $$
  select case when p_kind = 'stock' then upper($2) else lower($2) end
$$;

-- Leaderboard view: cash + sum of position market value.
create or replace view public.leaderboard as
  select p.username,
         p.cash_usd
           + coalesce((select sum(pos.qty * pc.price_usd)
                       from positions pos
                       join prices_cache pc
                         on pc.kind = pos.kind and pc.symbol = pos.symbol
                       where pos.user_id = p.id), 0) as total_usd
  from profiles p
  order by total_usd desc;

grant select on public.leaderboard to authenticated;
