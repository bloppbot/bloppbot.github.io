import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://musmrwvrpjukpeahwheu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_52plfSsRIlAzlsAAli9-9A_AZXAWUA-';
const DUMMY_DOMAIN = 'bloppbot.local';
const STARTING_CASH = 100000;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt = n => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const fmtQty = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });

// ---------- view routing ----------
function showView(name) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#${name}`)?.classList.remove('hidden');
  $$('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  if (name === 'portfolio') loadPortfolio();
  if (name === 'leaderboard') loadLeaderboard();
}

$$('nav a[data-view]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  showView(a.dataset.view);
}));

// ---------- auth ----------
const usernameToEmail = u => `${u.toLowerCase().trim()}@${DUMMY_DOMAIN}`;

async function signUp(username, password) {
  const { data, error } = await sb.auth.signUp({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error('signup returned no user');
  const { error: profErr } = await sb.from('profiles').insert({
    id: data.user.id,
    username: username.toLowerCase().trim(),
    cash_usd: STARTING_CASH,
  });
  if (profErr) {
    // If the username is taken, the unique constraint will trip; surface it.
    throw new Error(profErr.message.includes('duplicate') ? 'username taken' : profErr.message);
  }
}

async function signIn(username, password) {
  const { error } = await sb.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) throw error;
}

async function signOut() {
  await sb.auth.signOut();
  renderAuthState(null);
  showView('auth');
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $('#auth-msg');
  msg.textContent = '...';
  try {
    await signIn(f.get('username'), f.get('password'));
    msg.textContent = '';
  } catch (err) {
    msg.textContent = err.message;
  }
});

$('#signup-btn').addEventListener('click', async () => {
  const f = new FormData($('#login-form'));
  const msg = $('#auth-msg');
  const u = f.get('username'), p = f.get('password');
  if (!u || !p) { msg.textContent = 'fill both fields first'; return; }
  if (p.length < 6) { msg.textContent = 'password must be 6+ chars'; return; }
  msg.textContent = 'creating account...';
  try {
    await signUp(u, p);
    msg.textContent = '';
  } catch (err) {
    msg.textContent = err.message;
  }
});

function renderAuthState(session) {
  const slot = $('#user-slot');
  if (!session) {
    slot.textContent = '';
    return;
  }
  // read username from profile for display
  sb.from('profiles').select('username, cash_usd').eq('id', session.user.id).single()
    .then(({ data }) => {
      slot.innerHTML = `${data?.username || '?'} <button id="logout-btn">log out</button>`;
      $('#logout-btn').addEventListener('click', signOut);
    });
}

sb.auth.onAuthStateChange((_event, session) => {
  renderAuthState(session);
  if (session) {
    showView(location.hash.replace('#','') || 'portfolio');
  } else {
    showView('auth');
  }
});

// ---------- price fetching (via edge function) ----------
async function refreshPrice(kind, symbol) {
  const { data, error } = await sb.functions.invoke('refresh-price', {
    body: { kind, symbol },
  });
  if (error) throw new Error(`price refresh failed: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data.price_usd;
}

// ---------- portfolio ----------
async function loadPortfolio() {
  const { data: prof } = await sb.from('profiles').select('cash_usd').single();
  const { data: positions } = await sb.from('positions').select('*').order('symbol');
  const { data: trades } = await sb.from('trades').select('*').order('ts', { ascending: false }).limit(50);

  const syms = (positions || []).map(p => ({ kind: p.kind, symbol: p.symbol }));
  const prices = syms.length
    ? Object.fromEntries((await sb.from('prices_cache').select('*').in('symbol', syms.map(s => s.symbol))).data?.map(r => [`${r.kind}:${r.symbol}`, Number(r.price_usd)]) || [])
    : {};

  const cash = Number(prof?.cash_usd || 0);
  let posValue = 0;
  const rows = (positions || []).map(p => {
    const last = prices[`${p.kind}:${p.symbol}`];
    const value = last ? last * Number(p.qty) : null;
    if (value) posValue += value;
    const pl = last ? (last - Number(p.avg_cost_usd)) * Number(p.qty) : null;
    return `<tr>
      <td>${p.symbol}</td>
      <td>${fmtQty(p.qty)}</td>
      <td>${fmt(p.avg_cost_usd)}</td>
      <td>${last != null ? fmt(last) : '—'}</td>
      <td>${value != null ? fmt(value) : '—'}</td>
      <td class="${pl == null ? '' : pl >= 0 ? 'pos' : 'neg'}">${pl != null ? fmt(pl) : '—'}</td>
    </tr>`;
  }).join('');
  $('#positions tbody').innerHTML = rows || '<tr><td colspan="6">no positions yet. head to trade.</td></tr>';

  const total = cash + posValue;
  const pnl = total - STARTING_CASH;
  $('#portfolio-summary').innerHTML = `
    <div><span class="label">cash</span><span class="val">${fmt(cash)}</span></div>
    <div><span class="label">positions</span><span class="val">${fmt(posValue)}</span></div>
    <div><span class="label">total</span><span class="val">${fmt(total)}</span></div>
    <div><span class="label">all-time P/L</span><span class="val ${pnl >= 0 ? 'pos' : 'neg'}">${fmt(pnl)}</span></div>
  `;

  $('#trades tbody').innerHTML = (trades || []).map(t => `
    <tr>
      <td>${new Date(t.ts).toLocaleString()}</td>
      <td class="${t.side === 'buy' ? 'pos' : 'neg'}">${t.side}</td>
      <td>${t.symbol}</td>
      <td>${fmtQty(t.qty)}</td>
      <td>${fmt(t.price_usd)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">no trades yet.</td></tr>';
}

// ---------- trade ----------
$('#trade-form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#trade-msg');
  const f = new FormData(e.target);
  const kind = f.get('kind');
  const symbol = f.get('symbol').trim();
  const side = f.get('side');
  const qty = Number(f.get('qty'));
  msg.textContent = 'fetching price...';
  try {
    const price = await refreshPrice(kind, symbol);
    msg.textContent = `price ${fmt(price)} · placing order...`;
    const { data, error } = await sb.rpc('execute_trade', {
      p_kind: kind, p_symbol: symbol, p_side: side, p_qty: qty,
    });
    if (error) throw error;
    msg.textContent = `done. filled ${qty} @ ${fmt(data.price)} (cost ${fmt(data.cost)})`;
    e.target.reset();
  } catch (err) {
    msg.textContent = err.message;
  }
});

// live quote preview as user types
let quoteTimer;
$('#trade-form').addEventListener('input', () => {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    const f = new FormData($('#trade-form'));
    const symbol = (f.get('symbol') || '').trim();
    if (!symbol) { $('#quote-preview').textContent = ''; return; }
    $('#quote-preview').textContent = 'fetching...';
    try {
      const price = await refreshPrice(f.get('kind'), symbol);
      const qty = Number(f.get('qty') || 0);
      $('#quote-preview').innerHTML = `<strong>${symbol.toUpperCase()}</strong> ${fmt(price)}` +
        (qty > 0 ? ` · order cost ≈ ${fmt(price * qty)}` : '');
    } catch (err) {
      $('#quote-preview').textContent = err.message;
    }
  }, 500);
});

// ---------- leaderboard ----------
async function loadLeaderboard() {
  const { data, error } = await sb.from('leaderboard').select('*').limit(100);
  if (error) { $('#lb').innerHTML = `<li>${error.message}</li>`; return; }
  $('#lb').innerHTML = (data || []).map((r, i) => `
    <li><span class="rank">#${i + 1}</span> <span class="name">${r.username}</span> <span class="val">${fmt(r.total_usd)}</span></li>
  `).join('') || '<li>no players yet</li>';
}

// ---------- boot ----------
sb.auth.getSession().then(({ data }) => {
  if (data.session) {
    renderAuthState(data.session);
    showView(location.hash.replace('#','') || 'portfolio');
  } else {
    showView('auth');
  }
});
