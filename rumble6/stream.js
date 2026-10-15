// Rumble VI stream pages: stage scaling, fireflies, team table + live data from the prediction-game API (same source as /predict)
(function () {
  const stage = document.getElementById('stage');
  function fit() { const s = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%,-50%) scale(${s})`; }
  addEventListener('resize', fit); fit();
  for (let i = 0; i < 22; i++) {
    const e = document.createElement('div'); e.className = 'fly'; e.style.left = Math.random() * 100 + '%'; e.style.top = (35 + Math.random() * 65) + '%';
    e.style.animationDelay = (Math.random() * 16) + 's'; e.style.animationDuration = (Math.random() * 10 + 12) + 's'; stage.appendChild(e);
  }
})();
const R6 = {
  API: new URLSearchParams(location.search).get('api') || 'https://rumble6-predict.bloppbot.workers.dev',
  TEAMS: {
    burgerboys: ['Burger Boys', 'burgerboys_v2', '#5b8cff'], vikings: ['Vikings', 'vikings', '#7fb2e5'], gym: ['GYM Esports', 'gymesports', '#f2e030'],
    oldravens: ['Old Ravens', 'oldravens', '#e0334f'], tmnt: ['TMNT', 'tmnt', '#7cc242'], nwo: ['New World Order', 'nwo_v2', '#f5a623'],
    dontpeek: ["Don't Peek", 'dontpeek', '#a87cf0'], spacemarines: ['Space Marines', 'spacemarines', '#3fd0c9'],
  },
  esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  name: k => R6.TEAMS[k] ? R6.TEAMS[k][0] : k,
  logo: (k, cls = 'tlogo') => R6.TEAMS[k] ? `<img class="${cls}" src="assets/logos/${R6.TEAMS[k][1]}.png" alt="">` : '',
  acc: k => R6.TEAMS[k] ? R6.TEAMS[k][2] : '#93a896',
  time: ms => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }),
  // poll /api/config; render(cfg) on every change (results come in via /api/admin/state during the event)
  live(render, every = 20000) {
    let last = '';
    const load = () => fetch(R6.API + '/api/config', { cache: 'no-store' }).then(r => r.json()).then(cfg => {
      const sig = JSON.stringify([cfg.matches, cfg.results]); if (sig === last) return; last = sig; render(cfg);
    }).catch(() => {});
    load(); setInterval(load, every);
  },
};
