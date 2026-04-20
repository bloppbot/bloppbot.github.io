// Supabase edge function: fetch a live price for a (kind, symbol) and upsert
// into public.prices_cache. Called by authenticated clients before trading.
//
// Env vars required:
//   FINNHUB_API_KEY         — from https://finnhub.io/dashboard
//   SUPABASE_URL            — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//
// Deploy: supabase functions deploy refresh-price --no-verify-jwt=false
// (JWT verification is ON so only authenticated users can call.)

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

async function fetchStock(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase();
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`);
  if (!r.ok) throw new Error(`finnhub ${r.status}`);
  const j = await r.json();
  if (!j.c || j.c === 0) throw new Error(`no quote for ${sym}`);
  return Number(j.c);
}

async function fetchCrypto(id: string): Promise<number> {
  // CoinGecko expects lowercase coin ids (bitcoin, ethereum, solana, ...).
  const cid = id.toLowerCase();
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(cid)}&vs_currencies=usd`);
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = await r.json();
  const price = j?.[cid]?.usd;
  if (typeof price !== 'number') throw new Error(`no quote for ${cid}`);
  return price;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ error: 'POST only' }, 405);

  let body: { kind?: string; symbol?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const kind = body.kind, symbol = (body.symbol || '').trim();
  if (!symbol) return json({ error: 'missing symbol' }, 400);
  if (kind !== 'stock' && kind !== 'crypto') return json({ error: 'kind must be stock|crypto' }, 400);

  let price: number;
  try {
    price = kind === 'stock' ? await fetchStock(symbol) : await fetchCrypto(symbol);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  const storedSymbol = kind === 'stock' ? symbol.toUpperCase() : symbol.toLowerCase();
  const { error } = await admin.from('prices_cache').upsert({
    kind, symbol: storedSymbol, price_usd: price,
    updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: error.message }, 500);

  return json({ kind, symbol: storedSymbol, price_usd: price });
});
