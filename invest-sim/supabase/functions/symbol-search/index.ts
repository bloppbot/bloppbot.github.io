// Supabase edge function: autocomplete symbol search.
// Query: { q: string, kind?: 'stock'|'crypto'|'any' }
// Returns: { stocks: [{symbol,name}], crypto: [{id,symbol,name}] }
//
// Uses Finnhub /search for stocks and CoinGecko /search for crypto.

const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY')!;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function searchStocks(q: string) {
  const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.result || [])
    .filter((x: Record<string, unknown>) => x.type === 'Common Stock' || x.symbol)
    .slice(0, 10)
    .map((x: Record<string, unknown>) => ({ symbol: x.symbol, name: x.description }));
}

async function searchCrypto(q: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.coins || []).slice(0, 10).map((c: Record<string, unknown>) => ({
    id: c.id, symbol: (c.symbol as string)?.toUpperCase(), name: c.name,
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ error: 'POST only' }, 405);

  let body: { q?: string; kind?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const q = (body.q || '').trim();
  if (q.length < 1) return json({ stocks: [], crypto: [] });
  const kind = body.kind || 'any';

  const [stocks, crypto] = await Promise.all([
    kind === 'crypto' ? Promise.resolve([]) : searchStocks(q),
    kind === 'stock'  ? Promise.resolve([]) : searchCrypto(q),
  ]);

  return json({ stocks, crypto });
});
