import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://musmrwvrpjukpeahwheu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_52plfSsRIlAzlsAAli9-9A_AZXAWUA-';
const DUMMY_DOMAIN = 'bloppbot.local';
const STARTING_CASH = 100000;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- utilities ----------------
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const fmtBig = n => {
  if (n == null) return '—';
  const x = Number(n);
  if (Math.abs(x) >= 1e12) return '$' + (x / 1e12).toFixed(2) + 'T';
  if (Math.abs(x) >= 1e9)  return '$' + (x / 1e9).toFixed(2)  + 'B';
  if (Math.abs(x) >= 1e6)  return '$' + (x / 1e6).toFixed(2)  + 'M';
  return fmt(x);
};
const fmtQty = n => n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
const fmtPct = p => p == null ? '—' : (p >= 0 ? '+' : '') + Number(p).toFixed(2) + '%';
const relTime = ts => {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// ---------------- router ----------------
function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return { view: 'feed' };
  const [head, ...rest] = raw.split('/');
  if (head === 'user' && rest.length) return { view: 'user-profile', username: rest.join('/') };
  return { view: head };
}

function route() {
  const { view, username } = parseHash();
  const v = ['feed','portfolio','trade','watchlist','leaderboard','user-profile','settings'].includes(view) ? view : 'feed';
  if (!isLoggedIn()) {
    $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== 'auth'));
    return;
  }
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== v));
  $$('nav a[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  document.querySelector('header.nav nav')?.classList.remove('open');
  if (v === 'feed') loadFeed();
  if (v === 'portfolio') loadPortfolio();
  if (v === 'watchlist') loadWatchlist();
  if (v === 'leaderboard') loadLeaderboard($('#lb-tabs .active')?.dataset.range || 'all');
  if (v === 'user-profile') loadUserProfile(username);
  if (v === 'settings') loadSettings();
}

window.addEventListener('hashchange', route);

// mobile nav toggle
$('#nav-toggle')?.addEventListener('click', () => {
  document.querySelector('header.nav nav')?.classList.toggle('open');
});

// ---------------- auth ----------------
let currentUser = null;
const isLoggedIn = () => !!currentUser;
const usernameToEmail = u => `${u.toLowerCase().trim()}@${DUMMY_DOMAIN}`;

async function signUp(username, password) {
  const { data, error } = await sb.auth.signUp({ email: usernameToEmail(username), password });
  if (error) throw error;
  if (!data.user) throw new Error('signup returned no user');
  const { error: profErr } = await sb.from('profiles').insert({
    id: data.user.id,
    username: username.toLowerCase().trim(),
    cash_usd: STARTING_CASH,
  });
  if (profErr) throw new Error(profErr.message.includes('duplicate') ? 'username taken' : profErr.message);
}

async function signIn(username, password) {
  const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) throw error;
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null;
  renderAuthState(null);
  location.hash = '#feed';
  $('#auth').classList.remove('hidden');
  $$('main .view').forEach(v => { if (v.id !== 'auth') v.classList.add('hidden'); });
}

$('#login-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $('#auth-msg');
  msg.textContent = '...';
  try { await signIn(f.get('username'), f.get('password')); msg.textContent = ''; }
  catch (err) { msg.textContent = err.message; }
});

$('#signup-btn')?.addEventListener('click', async () => {
  const f = new FormData($('#login-form'));
  const msg = $('#auth-msg');
  const u = f.get('username'), p = f.get('password');
  if (!u || !p) { msg.textContent = 'fill both fields first'; return; }
  if (p.length < 6) { msg.textContent = 'password must be 6+ chars'; return; }
  msg.textContent = 'creating account...';
  try { await signUp(u, p); msg.textContent = ''; }
  catch (err) { msg.textContent = err.message; }
});

async function fetchMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  // retry briefly — profile insert may race with first auth event after signup
  for (let i = 0; i < 3; i++) {
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (data) return data;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

async function renderAuthState(session) {
  const slot = $('#user-slot');
  if (!session) { slot.innerHTML = ''; return; }
  const profile = await fetchMyProfile();
  if (!profile) { slot.innerHTML = '…'; return; }
  currentUser = profile;
  slot.innerHTML = `<a href="#user/${esc(profile.username)}" class="me">${esc(profile.username)}</a>
    <a href="#settings" title="settings">⚙</a>
    <button id="logout-btn">log out</button>`;
  $('#logout-btn').addEventListener('click', signOut);
}

sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    renderAuthState(session).then(() => {
      $('#auth').classList.add('hidden');
      route();
    });
  } else {
    currentUser = null;
    renderAuthState(null);
    $('#auth').classList.remove('hidden');
  }
});

// ---------------- edge function helpers ----------------
async function fetchSymbolMeta(kind, symbol) {
  const { data, error } = await sb.functions.invoke('refresh-price', { body: { kind, symbol } });
  if (error) throw new Error(`price refresh failed: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data;
}

async function searchSymbols(q, kind) {
  const { data, error } = await sb.functions.invoke('symbol-search', { body: { q, kind } });
  if (error) return { stocks: [], crypto: [] };
  return data || { stocks: [], crypto: [] };
}

// ---------------- feed ----------------
async function loadFeed() {
  const [{ data: trades }, { data: popular }] = await Promise.all([
    sb.from('recent_trades').select('*').limit(30),
    sb.from('popular_symbols').select('*').limit(10),
  ]);
  $('#feed-list').innerHTML = (trades || []).map(t => `
    <li class="feed-item">
      <span class="time">${relTime(t.ts)}</span>
      <a href="#user/${esc(t.username)}" class="name">${esc(t.username)}</a>
      <span class="side ${t.side}">${t.side}</span>
      <span class="qty">${fmtQty(t.qty)}</span>
      <strong>${esc(t.symbol)}</strong>
      <span class="price">@ ${fmt(t.price_usd)}</span>
    </li>
  `).join('') || '<li class="empty">no trades yet. be the first.</li>';

  $('#popular-list').innerHTML = (popular || []).map(p => `
    <li>
      ${p.logo_url ? `<img src="${esc(p.logo_url)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="psym"><strong>${esc(p.symbol)}</strong><span>${esc(p.name || '')}</span></div>
      <div class="pprice">${fmt(p.price_usd)}<span>${p.holders} hold</span></div>
    </li>
  `).join('') || '<li class="empty">no data yet</li>';
}

// ---------------- portfolio ----------------
async function loadPortfolio() {
  if (!currentUser) return;
  const [{ data: prof }, { data: positions }, { data: trades }, { data: snapshots }] = await Promise.all([
    sb.from('profiles').select('cash_usd').eq('id', currentUser.id).maybeSingle(),
    sb.from('positions').select('*').order('symbol'),
    sb.from('trades').select('*').order('ts', { ascending: false }).limit(50),
    sb.from('portfolio_snapshots').select('ts, total_usd').eq('user_id', currentUser.id).order('ts', { ascending: true }).limit(500),
  ]);

  const syms = (positions || []).map(p => p.symbol);
  const prices = syms.length
    ? Object.fromEntries(((await sb.from('prices_cache').select('*').in('symbol', syms)).data || [])
        .map(r => [`${r.kind}:${r.symbol}`, Number(r.price_usd)]))
    : {};

  const cash = Number(prof?.cash_usd || 0);
  let posValue = 0;
  $('#positions tbody').innerHTML = (positions || []).map(p => {
    const last = prices[`${p.kind}:${p.symbol}`];
    const value = last ? last * Number(p.qty) : null;
    if (value) posValue += value;
    const pl = last ? (last - Number(p.avg_cost_usd)) * Number(p.qty) : null;
    return `<tr>
      <td>${esc(p.symbol)}</td>
      <td>${fmtQty(p.qty)}</td>
      <td>${fmt(p.avg_cost_usd)}</td>
      <td>${fmt(last)}</td>
      <td>${fmt(value)}</td>
      <td class="${pl == null ? '' : pl >= 0 ? 'pos' : 'neg'}">${fmt(pl)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">no positions yet. head to trade.</td></tr>';

  const total = cash + posValue;
  const pnl = total - STARTING_CASH;
  $('#portfolio-summary').innerHTML = `
    <div><span class="label">cash</span><span class="val">${fmt(cash)}</span></div>
    <div><span class="label">positions</span><span class="val">${fmt(posValue)}</span></div>
    <div><span class="label">total</span><span class="val">${fmt(total)}</span></div>
    <div><span class="label">P/L</span><span class="val ${pnl >= 0 ? 'pos' : 'neg'}">${fmt(pnl)}</span></div>
  `;

  drawChart($('#portfolio-chart'), buildSeries(snapshots, total));

  $('#trades tbody').innerHTML = (trades || []).map(t => `
    <tr>
      <td>${new Date(t.ts).toLocaleString()}</td>
      <td class="${t.side === 'buy' ? 'pos' : 'neg'}">${t.side}</td>
      <td>${esc(t.symbol)}</td>
      <td>${fmtQty(t.qty)}</td>
      <td>${fmt(t.price_usd)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">no trades yet.</td></tr>';
}

function buildSeries(snapshots, currentTotal) {
  const pts = (snapshots || []).map(s => ({ t: new Date(s.ts).getTime(), v: Number(s.total_usd) }));
  if (!pts.length || pts[pts.length - 1].v !== currentTotal) {
    pts.push({ t: Date.now(), v: Number(currentTotal) });
  }
  // always seed with starting cash so the chart has context
  if (pts.length && pts[0].v !== STARTING_CASH) {
    pts.unshift({ t: pts[0].t - 1000, v: STARTING_CASH });
  }
  return pts;
}

// ---------------- chart (SVG line) ----------------
function drawChart(container, points) {
  if (!container) return;
  const W = container.clientWidth || 800, H = 180, PAD = 24;
  if (!points.length) { container.innerHTML = `<div class="chart-empty">trade to see your portfolio over time</div>`; return; }
  const minT = points[0].t, maxT = points[points.length - 1].t;
  const minV = Math.min(...points.map(p => p.v), STARTING_CASH * 0.98);
  const maxV = Math.max(...points.map(p => p.v), STARTING_CASH * 1.02);
  const spanT = Math.max(1, maxT - minT), spanV = Math.max(1, maxV - minV);
  const x = t => PAD + ((t - minT) / spanT) * (W - 2 * PAD);
  const y = v => H - PAD - ((v - minV) / spanV) * (H - 2 * PAD);
  const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
  const last = points[points.length - 1].v;
  const start = points[0].v;
  const positive = last >= start;
  const baseline = y(STARTING_CASH);
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart">
      <line x1="${PAD}" x2="${W - PAD}" y1="${baseline}" y2="${baseline}" class="chart-baseline"/>
      <path d="${d}" class="chart-line ${positive ? 'pos' : 'neg'}"/>
    </svg>
    <div class="chart-legend">
      <span>${fmt(start)} → ${fmt(last)}</span>
      <span class="${positive ? 'pos' : 'neg'}">${fmtPct(((last - start) / start) * 100)}</span>
    </div>
  `;
}

// ---------------- trade ----------------
let currentSymbolMeta = null;
let quoteDebounce, searchDebounce;

function toggleQtyMode() {
  const mode = document.querySelector('input[name="qty_mode"]:checked')?.value || 'qty';
  $('input[name="qty"]').classList.toggle('hidden', mode !== 'qty');
  $('input[name="cash"]').classList.toggle('hidden', mode !== 'cash');
}

$$('input[name="qty_mode"]').forEach(r => r.addEventListener('change', toggleQtyMode));

$('#trade-form').addEventListener('input', e => {
  const target = e.target;
  if (target?.name === 'symbol' || target?.name === 'kind') {
    clearTimeout(quoteDebounce);
    clearTimeout(searchDebounce);
    const f = new FormData($('#trade-form'));
    const q = (f.get('symbol') || '').trim();
    if (q.length < 1) { $('#symbol-info').classList.add('hidden'); $('#symbol-suggestions').classList.add('hidden'); return; }
    searchDebounce = setTimeout(async () => {
      const res = await searchSymbols(q, f.get('kind'));
      renderSuggestions(res, f.get('kind'));
    }, 250);
    quoteDebounce = setTimeout(async () => {
      try {
        const meta = await fetchSymbolMeta(f.get('kind'), q);
        currentSymbolMeta = meta;
        renderSymbolInfo(meta);
      } catch (err) {
        $('#symbol-info').innerHTML = `<span class="muted">${esc(err.message)}</span>`;
        $('#symbol-info').classList.remove('hidden');
        currentSymbolMeta = null;
      }
    }, 600);
  }
});

function renderSuggestions({ stocks, crypto }, kind) {
  const list = $('#symbol-suggestions');
  const items = [];
  if (kind !== 'crypto') items.push(...stocks.map(s => ({ kind: 'stock',  label: `${s.symbol} — ${s.name}`, value: s.symbol })));
  if (kind !== 'stock')  items.push(...crypto.map(c => ({ kind: 'crypto', label: `${c.symbol || c.id} — ${c.name}`, value: c.id })));
  if (!items.length) { list.classList.add('hidden'); return; }
  list.innerHTML = items.slice(0, 12).map(it => `<li data-kind="${it.kind}" data-val="${esc(it.value)}">${esc(it.label)}</li>`).join('');
  list.classList.remove('hidden');
  list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
    const kindSel = $('select[name="kind"]'); kindSel.value = li.dataset.kind;
    $('input[name="symbol"]').value = li.dataset.val;
    list.classList.add('hidden');
    $('#trade-form').dispatchEvent(new Event('input', { bubbles: true }));
  }));
}

async function renderSymbolInfo(meta) {
  const el = $('#symbol-info');
  el.classList.remove('hidden');
  const sub = [meta.exchange, meta.industry].filter(Boolean).join(' · ');
  // Check if already watched
  let watching = false;
  if (currentUser) {
    const { data } = await sb.from('watchlists').select('symbol').eq('kind', meta.kind).eq('symbol', meta.symbol).maybeSingle();
    watching = !!data;
  }
  el.innerHTML = `
    ${meta.logo_url ? `<img src="${esc(meta.logo_url)}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="info-body">
      <strong>${esc(meta.symbol)}</strong>
      <span class="sym-name">${esc(meta.name || '')}</span>
      <span class="sym-sub">${esc(sub)}${meta.market_cap ? ' · ' + fmtBig(meta.market_cap) + ' mcap' : ''}</span>
      ${meta.description ? `<p class="sym-desc">${esc(meta.description.substring(0, 200))}${meta.description.length > 200 ? '…' : ''}</p>` : ''}
    </div>
    <div class="info-price">${fmt(meta.price_usd)}
      <button class="watch-btn" data-watch>${watching ? '★ watching' : '☆ watch'}</button>
    </div>
  `;
}

// trade submit → modal confirm → execute_trade or execute_trade_cash
$('#trade-form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#trade-msg');
  const f = new FormData(e.target);
  const kind = f.get('kind'), symbol = (f.get('symbol') || '').trim(), side = f.get('side');
  const mode = f.get('qty_mode');
  const qty = Number(f.get('qty') || 0), cash = Number(f.get('cash') || 0);
  if (mode === 'qty' && qty <= 0) { msg.textContent = 'enter a quantity'; return; }
  if (mode === 'cash' && cash <= 0) { msg.textContent = 'enter a $ amount'; return; }
  msg.textContent = 'fetching price...';
  let meta;
  try { meta = await fetchSymbolMeta(kind, symbol); }
  catch (err) { msg.textContent = err.message; return; }
  msg.textContent = '';

  const approxQty = mode === 'qty' ? qty : cash / meta.price_usd;
  const approxCost = mode === 'qty' ? qty * meta.price_usd : cash;

  const confirmed = await showModal({
    title: `${side === 'buy' ? 'buy' : 'sell'} ${esc(meta.symbol)}`,
    body: `
      <div class="modal-row"><span>price</span><strong>${fmt(meta.price_usd)}</strong></div>
      <div class="modal-row"><span>quantity</span><strong>${fmtQty(approxQty)}</strong></div>
      <div class="modal-row"><span>${side === 'buy' ? 'cost' : 'proceeds'}</span><strong>${fmt(approxCost)}</strong></div>
      <div class="modal-row"><span>cash after</span><strong>${fmt((Number(currentUser.cash_usd) || 0) + (side === 'buy' ? -approxCost : approxCost))}</strong></div>
      <p class="muted">actual fill includes ±0.2% slippage.</p>
    `,
  });
  if (!confirmed) return;

  msg.textContent = 'placing order...';
  try {
    const rpcName = mode === 'cash' ? 'execute_trade_cash' : 'execute_trade';
    const args = mode === 'cash'
      ? { p_kind: kind, p_symbol: symbol, p_side: side, p_cash_usd: cash }
      : { p_kind: kind, p_symbol: symbol, p_side: side, p_qty: qty };
    const { data, error } = await sb.rpc(rpcName, args);
    if (error) throw error;
    msg.textContent = `filled @ ${fmt(data.price)} (cost ${fmt(data.cost)}, slip ${Number(data.slippage_bps).toFixed(1)} bps)`;
    // refresh profile cash
    const p = await fetchMyProfile();
    if (p) currentUser = p;
    e.target.reset();
    toggleQtyMode();
  } catch (err) {
    msg.textContent = err.message;
  }
});

// ---------------- watchlist ----------------
async function loadWatchlist() {
  if (!currentUser) return;
  const { data: rows } = await sb.from('watchlists').select('*').order('added_at', { ascending: false });
  const syms = (rows || []).map(r => r.symbol);
  const priceMap = syms.length
    ? Object.fromEntries(((await sb.from('prices_cache').select('*').in('symbol', syms)).data || [])
        .map(r => [`${r.kind}:${r.symbol}`, Number(r.price_usd)]))
    : {};
  const symMeta = syms.length
    ? Object.fromEntries(((await sb.from('symbols').select('*').in('symbol', syms)).data || [])
        .map(r => [`${r.kind}:${r.symbol}`, r]))
    : {};
  $('#watchlist-table tbody').innerHTML = (rows || []).map(r => {
    const k = `${r.kind}:${r.symbol}`;
    const m = symMeta[k] || {};
    return `<tr>
      <td><strong>${esc(r.symbol)}</strong></td>
      <td>${esc(m.name || '')}</td>
      <td>${fmt(priceMap[k])}</td>
      <td><button class="link-btn" data-unwatch="${esc(r.kind)}:${esc(r.symbol)}">remove</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="empty">nothing yet. search a symbol and click the star.</td></tr>';
  $$('#watchlist-table [data-unwatch]').forEach(b => b.addEventListener('click', async () => {
    const [k, s] = b.dataset.unwatch.split(':');
    await sb.from('watchlists').delete().match({ kind: k, symbol: s });
    loadWatchlist();
  }));
}

// ---------------- leaderboard ----------------
$('#lb-tabs')?.addEventListener('click', e => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  $$('#lb-tabs button').forEach(x => x.classList.toggle('active', x === b));
  loadLeaderboard(b.dataset.range);
});

async function loadLeaderboard(range) {
  const list = $('#lb');
  if (range === 'all') {
    const { data } = await sb.from('leaderboard').select('*').limit(100);
    list.innerHTML = (data || []).map((r, i) => `
      <li><span class="rank">#${i + 1}</span>
        <a href="#user/${esc(r.username)}" class="name">${esc(r.username)}</a>
        <span class="val">${fmt(r.total_usd)}</span></li>
    `).join('') || '<li class="empty">no players yet</li>';
    return;
  }
  const since = new Date(Date.now() - (range === 'daily' ? 1 : 7) * 86400 * 1000).toISOString();
  const { data } = await sb.rpc('leaderboard_window', { p_since: since });
  list.innerHTML = (data || []).map((r, i) => `
    <li><span class="rank">#${i + 1}</span>
      <a href="#user/${esc(r.username)}" class="name">${esc(r.username)}</a>
      <span class="val ${Number(r.pnl_usd) >= 0 ? 'pos' : 'neg'}">${fmtPct(Number(r.pnl_pct))}</span>
      <span class="sub">${fmt(r.pnl_usd)} · now ${fmt(r.end_total)}</span></li>
  `).join('') || '<li class="empty">no snapshots in window yet</li>';
}

// ---------------- user profile ----------------
async function loadUserProfile(username) {
  if (!username) return;
  const { data: prof } = await sb.from('profiles').select('id, username, cash_usd, avatar_url, bio, created_at').eq('username', username).maybeSingle();
  if (!prof) { $('#user-header').innerHTML = `<p>user not found</p>`; return; }
  // public queries (positions/trades/snapshots) — positions & trades have RLS so we can only read our own.
  // Expose user-visible aggregates via the leaderboard view + public trade log.
  const [totalRow, { data: snapshots }, { data: publicTrades }] = await Promise.all([
    sb.from('leaderboard').select('*').eq('username', username).maybeSingle(),
    sb.from('portfolio_snapshots').select('ts, total_usd').eq('user_id', prof.id).order('ts', { ascending: true }).limit(500),
    sb.from('recent_trades').select('*').eq('username', username).limit(50),
  ]);
  const total = Number(totalRow?.data?.total_usd ?? totalRow?.total_usd ?? STARTING_CASH);
  const pnl = total - STARTING_CASH;
  $('#user-header').innerHTML = `
    <div class="user-card">
      ${prof.avatar_url ? `<img src="${esc(prof.avatar_url)}" class="avatar" onerror="this.style.display='none'">`
                      : `<div class="avatar placeholder">${esc(prof.username.charAt(0).toUpperCase())}</div>`}
      <div>
        <h2>${esc(prof.username)}</h2>
        ${prof.bio ? `<p class="bio">${esc(prof.bio)}</p>` : '<p class="bio muted">no bio</p>'}
        <div class="user-stats">
          <span><span class="label">total</span><strong>${fmt(total)}</strong></span>
          <span><span class="label">P/L</span><strong class="${pnl >= 0 ? 'pos' : 'neg'}">${fmt(pnl)}</strong></span>
          <span><span class="label">joined</span><strong>${new Date(prof.created_at).toLocaleDateString()}</strong></span>
        </div>
      </div>
    </div>
  `;
  drawChart($('#user-chart'), buildSeries(snapshots, total));

  // Positions: only visible if this is the current user (due to RLS on positions).
  // For other users we just show recent trades.
  let positionsRows;
  if (currentUser && currentUser.id === prof.id) {
    const { data: positions } = await sb.from('positions').select('*').order('symbol');
    const syms = (positions || []).map(p => p.symbol);
    const prices = syms.length
      ? Object.fromEntries(((await sb.from('prices_cache').select('*').in('symbol', syms)).data || [])
          .map(r => [`${r.kind}:${r.symbol}`, Number(r.price_usd)]))
      : {};
    positionsRows = (positions || []).map(p => {
      const last = prices[`${p.kind}:${p.symbol}`];
      const value = last ? last * Number(p.qty) : null;
      return `<tr><td>${esc(p.symbol)}</td><td>${fmtQty(p.qty)}</td><td>${fmt(p.avg_cost_usd)}</td><td>${fmt(last)}</td><td>${fmt(value)}</td></tr>`;
    }).join('');
  } else {
    positionsRows = '<tr><td colspan="5" class="empty">positions are private</td></tr>';
  }
  $('#user-positions tbody').innerHTML = positionsRows || '<tr><td colspan="5" class="empty">no positions</td></tr>';

  $('#user-trades tbody').innerHTML = (publicTrades || []).map(t => `
    <tr><td>${new Date(t.ts).toLocaleString()}</td>
      <td class="${t.side === 'buy' ? 'pos' : 'neg'}">${t.side}</td>
      <td>${esc(t.symbol)}</td>
      <td>${fmtQty(t.qty)}</td>
      <td>${fmt(t.price_usd)}</td></tr>
  `).join('') || '<tr><td colspan="5" class="empty">no trades</td></tr>';
}

$('#user-back')?.addEventListener('click', () => history.back());

// ---------------- settings ----------------
async function loadSettings() {
  if (!currentUser) return;
  $('input[name="avatar_url"]').value = currentUser.avatar_url || '';
  $('textarea[name="bio"]').value = currentUser.bio || '';
}

$('#profile-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#profile-msg');
  const f = new FormData(e.target);
  const { error } = await sb.from('profiles').update({
    avatar_url: f.get('avatar_url') || null,
    bio: f.get('bio') || null,
  }).eq('id', currentUser.id);
  if (error) msg.textContent = error.message;
  else {
    msg.textContent = 'saved.';
    const p = await fetchMyProfile();
    if (p) currentUser = p;
  }
});

// ---------------- modal ----------------
function showModal({ title, body }) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-backdrop').classList.remove('hidden');
  return new Promise(resolve => {
    const onCancel = () => { cleanup(); resolve(false); };
    const onConfirm = () => { cleanup(); resolve(true); };
    const onKey = e => { if (e.key === 'Escape') onCancel(); else if (e.key === 'Enter') onConfirm(); };
    function cleanup() {
      $('#modal-backdrop').classList.add('hidden');
      $('#modal-cancel').removeEventListener('click', onCancel);
      $('#modal-confirm').removeEventListener('click', onConfirm);
      window.removeEventListener('keydown', onKey);
    }
    $('#modal-cancel').addEventListener('click', onCancel);
    $('#modal-confirm').addEventListener('click', onConfirm);
    window.addEventListener('keydown', onKey);
  });
}

// ---------------- watchlist star on trade view ----------------
$('#symbol-info').addEventListener('click', async e => {
  if (!e.target.matches('[data-watch]')) return;
  if (!currentSymbolMeta || !currentUser) return;
  const watching = e.target.textContent.startsWith('★');
  if (watching) {
    await sb.from('watchlists').delete().match({
      user_id: currentUser.id, kind: currentSymbolMeta.kind, symbol: currentSymbolMeta.symbol,
    });
    e.target.textContent = '☆ watch';
  } else {
    await sb.from('watchlists').upsert({
      user_id: currentUser.id, kind: currentSymbolMeta.kind, symbol: currentSymbolMeta.symbol,
    });
    e.target.textContent = '★ watching';
  }
});

// ---------------- boot ----------------
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await renderAuthState(session);
    $('#auth').classList.add('hidden');
    route();
  } else {
    $('#auth').classList.remove('hidden');
  }
})();
