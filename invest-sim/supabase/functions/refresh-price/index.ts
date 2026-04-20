// Supabase edge function: fetch a live price + symbol metadata for a
// (kind, symbol) pair, upsert both into prices_cache and symbols. Called by
// the client before every trade and on quote-preview hovers.
//
// Env vars required:
//   FINNHUB_API_KEY         — from https://finnhub.io/dashboard
//   SUPABASE_URL            — auto
//   SUPABASE_SERVICE_ROLE_KEY — auto

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type StockMeta = { price: number; name?: string; logo_url?: string; exchange?: string; industry?: string; market_cap?: number; description?: string };
type CryptoMeta = { price: number; name?: string; logo_url?: string; description?: string };

async function fetchStock(symbol: string): Promise<StockMeta> {
  const sym = symbol.toUpperCase();
  const [quoteRes, profileRes] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`),
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`),
  ]);
  if (!quoteRes.ok) throw new Error(`finnhub quote ${quoteRes.status}`);
  const q = await quoteRes.json();
  if (!q.c || q.c === 0) throw new Error(`no quote for ${sym}`);
  let profile: Record<string, unknown> = {};
  if (profileRes.ok) {
    try { profile = await profileRes.json(); } catch { profile = {}; }
  }
  return {
    price: Number(q.c),
    name: (profile.name as string) || undefined,
    logo_url: (profile.logo as string) || undefined,
    exchange: (profile.exchange as string) || undefined,
    industry: (profile.finnhubIndustry as string) || undefined,
    market_cap: typeof profile.marketCapitalization === 'number' ? profile.marketCapitalization * 1_000_000 : undefined,
    description: undefined,
  };
}

async function fetchCrypto(id: string): Promise<CryptoMeta> {
  const cid = id.toLowerCase();
  // Single CoinGecko call gives both price and metadata. Use /coins/{id} with minimal fields.
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cid)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json();
  const price = j?.market_data?.current_price?.usd;
  if (typeof price !== 'number') throw new Error(`no quote for ${cid}`);
  return {
    price,
    name: j?.name as string,
    logo_url: j?.image?.large || j?.image?.small || j?.image?.thumb,
    description: (j?.description?.en as string)?.substring(0, 400) || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ error: 'POST only' }, 405);

  let body: { kind?: string; symbol?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const kind = body.kind, symbol = (body.symbol || '').trim();
  if (!symbol) return json({ error: 'missing symbol' }, 400);
  if (kind !== 'stock' && kind !== 'crypto') return json({ error: 'kind must be stock|crypto' }, 400);

  let meta: StockMeta | CryptoMeta;
  try {
    meta = kind === 'stock' ? await fetchStock(symbol) : await fetchCrypto(symbol);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  const storedSymbol = kind === 'stock' ? symbol.toUpperCase() : symbol.toLowerCase();
  const now = new Date().toISOString();

  const { error: priceErr } = await admin.from('prices_cache').upsert({
    kind, symbol: storedSymbol, price_usd: meta.price, updated_at: now,
  });
  if (priceErr) return json({ error: priceErr.message }, 500);

  const { error: symErr } = await admin.from('symbols').upsert({
    kind, symbol: storedSymbol,
    name: meta.name ?? null,
    logo_url: meta.logo_url ?? null,
    exchange: ('exchange' in meta ? meta.exchange : null) ?? null,
    industry: ('industry' in meta ? meta.industry : null) ?? null,
    market_cap: ('market_cap' in meta ? meta.market_cap : null) ?? null,
    description: meta.description ?? null,
    updated_at: now,
  });
  if (symErr) return json({ error: symErr.message }, 500);

  return json({
    kind, symbol: storedSymbol, price_usd: meta.price,
    name: meta.name, logo_url: meta.logo_url,
    exchange: 'exchange' in meta ? meta.exchange : undefined,
    industry: 'industry' in meta ? meta.industry : undefined,
    market_cap: 'market_cap' in meta ? meta.market_cap : undefined,
    description: meta.description,
  });
});
