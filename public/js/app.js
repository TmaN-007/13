import { analyze, canBeat, describe, legalPlays, isBomb, rankOf, TWO, label } from '/shared/rules.js';
import { cardEl, backEl, cardTag } from './cards.js';
import { sfx, isMuted, toggleMute } from './sound.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------------------------------------------------------- identity
const token = localStorage.getItem('thirteen.token') || (() => {
  const t = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
  localStorage.setItem('thirteen.token', t);
  return t;
})();
let myName = localStorage.getItem('thirteen.name') || '';
let roomCode = null;

// ---------------------------------------------------------------- client state
let S = null;                 // latest room view from the server
let clockSkew = 0;
const selected = new Set();
let hints = [];
let hintIdx = -1;
let lobbyOverride = false;    // user chose to look at the lobby between hands
let resultsSeenFor = 0;       // hand number whose results modal was dismissed
let tab = 'log';
let unread = 0;
const handEls = new Map();    // card id -> element in my hand
const seatEls = new Map();    // player id -> seat element

const socket = io({ transports: ['websocket', 'polling'] });

// ---------------------------------------------------------------- helpers
const PALETTE = ['#8a4b2f', '#3f6b5a', '#6a4c8c', '#2f5d8a', '#8a6a2f', '#7a3346', '#40707a', '#5b6b2f'];
function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const initials = (name) => (name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
const avatar = (p) => `<div class="avatar" style="--c:${colorFor(p.id)}">${esc(initials(p.name))}</div>`;
const player = (id) => S?.players.find((p) => p.id === id);
const nameOf = (id) => (id === S?.me ? 'You' : player(id)?.name ?? '—');
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n] || 'th');
const fmtPts = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const ptsClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const now = () => Date.now() + clockSkew;

function toast(html, kind = '', ms = 2600) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = html;
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

function emit(ev, payload) {
  return new Promise((resolve) => {
    socket.emit(ev, payload, (res) => {
      if (res?.error) { toast(esc(res.error), 'err'); sfx.error(); }
      resolve(res || {});
    });
  });
}

function show(id) {
  for (const s of ['home', 'lobby', 'table']) $('#' + s).hidden = s !== id;
}

const inviteLink = () => `${location.origin}/t/${roomCode}`;
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt('Copy this:', text); }
}

// ================================================================= HOME
function renderBrandFan() {
  const fan = $('#brandFan');
  const cards = [48, 51, 44, 0, 45]; // 2♠ 2♥ A♠ 3♠ A♣
  cards.forEach((c, i) => {
    const el = cardEl(c);
    const a = (i - 2) * 13;
    el.style.transform = `translateX(-50%) rotate(${a}deg)`;
    el.style.animationDelay = `${i * 70}ms`;
    fan.append(el);
  });
}

function initHome() {
  renderBrandFan();
  const nameInput = $('#nameInput');
  nameInput.value = myName;
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9]{4})/);
  if (m) $('#codeInput').value = m[1].toUpperCase();

  const getName = () => {
    const n = nameInput.value.trim();
    if (!n) { $('#homeError').textContent = 'Pick a name first.'; nameInput.focus(); return null; }
    myName = n;
    localStorage.setItem('thirteen.name', n);
    $('#homeError').textContent = '';
    return n;
  };

  $('#hostBtn').onclick = async () => {
    const name = getName();
    if (!name) return;
    const res = await emit('create', { name, token });
    if (res.code) enterRoom(res.code);
  };
  $('#homeForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = getName();
    if (!name) return;
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('#homeError').textContent = 'Table codes are 4 characters.'; $('#codeInput').focus(); return; }
    const res = await emit('join', { code, name, token });
    if (res.code) enterRoom(res.code);
    else if (res.error) $('#homeError').textContent = res.error;
  };
  $('#codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  // Came in through an invite link with a remembered name? Sit straight down.
  if (m && myName) {
    emit('join', { code: m[1].toUpperCase(), name: myName, token }).then((res) => {
      if (res.code) enterRoom(res.code);
      else { history.replaceState(null, '', '/'); $('#homeError').textContent = res.error || ''; }
    });
  }
}

function enterRoom(code) {
  roomCode = code;
  sessionStorage.setItem('thirteen.room', code);
  if (location.pathname !== `/t/${code}`) history.replaceState(null, '', `/t/${code}`);
}

function leaveRoom() {
  emit('leave');
  roomCode = null;
  S = null;
  sessionStorage.removeItem('thirteen.room');
  history.replaceState(null, '', '/');
  handEls.clear();
  seatEls.clear();
  $('#hand').innerHTML = '';
  $('#seats').innerHTML = '';
  $('#resultsModal').hidden = true;
  show('home');
}

socket.on('connect', () => {
  if (roomCode) emit('join', { code: roomCode, name: myName, token });
});
socket.on('disconnect', () => { if (roomCode) toast('Connection lost — reconnecting…', 'err', 3000); });
socket.on('kicked', () => { toast('The host removed you from the table.', 'err', 4000); leaveRoom(); });

// ================================================================= STATE
socket.on('state', (view, fx = []) => {
  const prev = S;
  clockSkew = view.now - Date.now();
  // capture where my played cards are right now, so they can fly from the hand to the pile
  const origins = new Map();
  for (const f of fx) {
    if (f.type === 'play') {
      if (f.by === view.me) for (const c of f.cards) { const el = handEls.get(c); if (el) origins.set(c, el.getBoundingClientRect()); }
      else { const seat = seatEls.get(f.by); if (seat) { const r = seat.querySelector('.mini-hand')?.getBoundingClientRect(); if (r) for (const c of f.cards) origins.set(c, { left: r.left + r.width / 2 - 15, top: r.top + 2, width: 30, height: 42 }); } }
    }
  }
  S = view;
  if (fx.some((f) => f.type === 'deal')) { lobbyOverride = false; selected.clear(); hints = []; }
  render(prev, fx, origins);
  handleFx(prev, fx, origins);
});

function currentScreen() {
  if (!S) return 'home';
  const g = S.game;
  const inHand = g && g.order.includes(S.me);
  if (inHand && g.phase !== 'over') return 'table';
  if (inHand && g.phase === 'over' && !lobbyOverride) return 'table';
  return 'lobby';
}

function render(prev, fx, origins) {
  const screen = currentScreen();
  show(screen);
  if (screen === 'lobby') renderLobby();
  if (screen === 'table') renderTable(prev, fx, origins);
}

// ================================================================= LOBBY
const SETTINGS = [
  { k: 'tribute', t: 'Tribute', vi: 'cống', d: 'Last place gives their highest card to the winner, who gives any card back.' },
  { k: 'winnerLeads', t: 'Winner leads', d: 'After hand one, the last winner leads. Off: the lowest card always leads.' },
  { k: 'firstLeadLowest', t: 'Open with the lowest card', d: 'Whoever leads with the lowest card (3♠) has to play it.' },
  { k: 'instantWin', t: 'Instant wins', vi: 'tới trắng', d: 'Four 2s, a dragon, six pairs or five consecutive pairs win on the deal.' },
  { k: 'chopPenalty', t: 'Chop penalties', vi: 'chặt heo', d: 'Getting your 2s or bombs chopped costs you points.' },
  { k: 'stuckTwoPenalty', t: 'Stuck pigs', vi: 'thối heo', d: 'Finish last still holding 2s and you pay for them.' },
  { k: 'frozenPenalty', t: 'Frozen', vi: 'cóng', d: "Haven't played a card when someone goes out? Dead last, plus a penalty." },
  { k: 'turnSeconds', t: 'Turn timer', d: 'Auto-pass when time runs out.', seg: [[0, 'Off'], [15, '15s'], [30, '30s'], [45, '45s']] },
];

function renderLobby() {
  const isHost = S.hostId === S.me;
  const host = player(S.hostId);
  $('#lobbyCode').textContent = S.code;
  $('#inviteCode').textContent = S.code;

  // seats
  const seats = $('#lobbySeats');
  const cells = [];
  for (let i = 0; i < 4; i++) {
    const p = S.players[i];
    if (!p) {
      cells.push(`<div class="seat-card open"><span>Open seat</span>${isHost ? '<button class="btn btn-ghost btn-sm" data-add-bot>+ Add a bot</button>' : ''}</div>`);
      continue;
    }
    const tags = [
      p.id === S.hostId && '<span class="tag host">Host</span>',
      p.id === S.me && '<span class="tag you">You</span>',
      p.isBot && '<span class="tag">Bot</span>',
      !p.isBot && !p.connected && '<span class="tag off">Away</span>',
    ].filter(Boolean).join('');
    cells.push(`<div class="seat-card ${p.id === S.me ? 'me' : ''}">${avatar(p)}
      <div class="who"><div class="nm">${esc(p.name)}</div><div class="meta">${tags}</div></div>
      ${isHost && p.id !== S.me ? `<button class="btn btn-ghost btn-sm kick" data-kick="${p.id}">${p.isBot ? 'Remove' : 'Kick'}</button>` : ''}</div>`);
  }
  seats.innerHTML = cells.join('');
  $$('[data-add-bot]', seats).forEach((b) => (b.onclick = () => emit('addBot')));
  $$('[data-kick]', seats).forEach((b) => (b.onclick = () => emit('kick', b.dataset.kick)));

  // settings
  $('#rulesOwner').textContent = isHost ? 'You set the rules' : `Set by ${host?.name ?? 'the host'}`;
  const list = $('#settingsList');
  list.innerHTML = SETTINGS.map((s) => {
    const v = S.settings[s.k];
    const ctl = s.seg
      ? `<div class="seg">${s.seg.map(([val, txt]) => `<button data-k="${s.k}" data-v="${val}" class="${v === val ? 'on' : ''}" ${isHost ? '' : 'disabled'}>${txt}</button>`).join('')}</div>`
      : `<label class="switch"><input type="checkbox" data-k="${s.k}" ${v ? 'checked' : ''} ${isHost ? '' : 'disabled'}><i></i></label>`;
    return `<div class="setting"><div class="txt"><b>${s.t}${s.vi ? ` <span lang="vi" style="display:inline;color:var(--ink-faint);font-weight:600">· ${s.vi}</span>` : ''}</b><span>${s.d}</span></div>${ctl}</div>`;
  }).join('');
  $$('input[data-k]', list).forEach((i) => (i.onchange = () => emit('settings', { [i.dataset.k]: i.checked })));
  $$('button[data-k]', list).forEach((b) => (b.onclick = () => emit('settings', { [b.dataset.k]: Number(b.dataset.v) })));

  // start
  const n = S.players.length;
  const start = $('#startBtn');
  const midHand = S.game && S.game.phase !== 'over';
  start.hidden = !isHost;
  start.disabled = n < 2 || midHand;
  start.textContent = S.handNo > 0 ? 'Deal next hand' : 'Deal the cards';
  $('#startHint').textContent = midHand
    ? 'A hand is being played — you can sit in from the next one.'
    : n < 2 ? (isHost ? 'Waiting for at least one more player — or add a bot.' : 'Waiting for more players…')
      : isHost ? `${n} players seated.` : `Waiting for ${host?.name ?? 'the host'} to deal…`;

  // standings
  $('#lobbyScores').hidden = S.handNo === 0;
  $('#lobbyStandings').innerHTML = standingsHTML();
}

function standingsHTML() {
  return [...S.players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => `<li class="${p.id === S.me ? 'me' : ''}"><span class="pos">${i + 1}</span>${avatar(p)}<span class="nm">${esc(p.name)}${p.isBot ? ' <span class="tag">Bot</span>' : ''}</span><span class="pts ${ptsClass(p.score)}">${fmtPts(p.score)}</span></li>`)
    .join('');
}

// ================================================================= TABLE
const POSITIONS = { 2: ['top'], 3: ['tr', 'tl'], 4: ['right', 'top', 'left'] };

function renderTable(prev, fx, origins) {
  const g = S.game;
  $('#tableCode').textContent = S.code;
  $('#handLabel').textContent = `Hand #${g.handNo}`;
  $('#sideHand').textContent = `after ${S.handNo} hand${S.handNo === 1 ? '' : 's'}`;
  $('#soundBtn').textContent = isMuted() ? '♪̸' : '♪';
  $('#standings').innerHTML = standingsHTML();
  renderSeats();
  renderPile(prev, fx, origins);
  renderMe(fx);
  renderFeeds();
  renderResults();
}

function seatStatus(id) {
  const g = S.game;
  const place = g.finished.indexOf(id);
  if (g.frozen.includes(id)) return '<span class="chip frozen">Frozen</span>';
  if (place >= 0 && (g.phase !== 'over' || g.counts[id] === 0)) return `<span class="chip place">${ordinal(place + 1)}</span>`;
  if (g.phase === 'over' && place >= 0) return `<span class="chip">${ordinal(place + 1)}</span>`;
  if (g.trick.passed.includes(id)) return '<span class="chip passed">Passed</span>';
  if (g.phase === 'tribute' && g.tribute.to === id) return '<span class="chip">Choosing…</span>';
  if (g.turn === id) return '<span class="chip" style="color:var(--brass-2)">Thinking…</span>';
  return '';
}

function ringHTML(id) {
  const g = S.game;
  const actor = g.phase === 'tribute' ? g.tribute?.to : g.turn;
  if (actor !== id || !S.deadline) return '';
  const total = Math.max(S.settings.turnSeconds || 20, g.phase === 'tribute' ? 20 : 0) * 1000;
  const left = Math.max(0, S.deadline - now());
  return `<svg class="ring run" viewBox="0 0 48 48" style="--d:${total}"><circle cx="24" cy="24" r="22" style="animation-duration:${total}ms;animation-delay:${left - total}ms"/></svg>`;
}

function renderSeats() {
  const g = S.game;
  const order = g.order;
  const me = order.indexOf(S.me);
  const others = order.slice(me + 1).concat(order.slice(0, me));
  const pos = POSITIONS[order.length] || [];
  const wrap = $('#seats');
  for (const [id, el] of seatEls) if (!others.includes(id)) { el.remove(); seatEls.delete(id); }

  others.forEach((id, i) => {
    let el = seatEls.get(id);
    if (!el) {
      el = document.createElement('div');
      el.innerHTML = '<div class="seat-body"></div>';
      wrap.append(el);
      seatEls.set(id, el);
    }
    const p = player(id) || { id, name: '—' };
    const actor = g.phase === 'tribute' ? g.tribute?.to : g.turn;
    const count = g.counts[id];
    el.className = `seat pos-${pos[i]}${actor === id ? ' turn' : ''}${g.finished.includes(id) || g.frozen.includes(id) ? ' done' : ''}`;
    const sub = p.isBot ? 'bot' : p.left ? 'left' : !p.connected ? 'away' : `${fmtPts(p.score)} pts`;
    el.querySelector('.seat-body').innerHTML = `
      <div class="seat-plate">${avatar(p)}${ringHTML(id)}
        <div class="info"><div class="nm">${esc(p.name)}</div><div class="sub">${sub}</div></div>
      </div>
      <div class="mini-hand" data-count="${count}"></div>
      <div class="seat-status">${seatStatus(id)}</div>`;
    const mini = el.querySelector('.mini-hand');
    if (g.phase === 'over' && count > 0) {
      // reveal what they were stuck with
      const cards = g.result?.leftovers?.[id] || [];
      cards.forEach((c, k) => {
        const ce = cardEl(c);
        ce.style.cssText = `--cw:26px;position:absolute;left:${(k - (cards.length - 1) / 2) * 11 + 42}px;top:0;`;
        mini.append(ce);
      });
    } else {
      const shown = Math.min(count, 13);
      for (let k = 0; k < shown; k++) {
        const b = backEl();
        const a = (k - (shown - 1) / 2) * 5;
        b.style.transform = `translateX(-50%) rotate(${a}deg)`;
        mini.append(b);
      }
      if (count > 0) mini.insertAdjacentHTML('beforeend', `<span class="count-badge ${count <= 2 && g.phase === 'playing' ? 'warn' : ''}">${count}</span>`);
    }
  });
}

function playGroupHTML(play, depth, isLatest) {
  const t = depth;
  const style = isLatest ? '' : `transform: translate(${-t * 30}px, ${-t * 12}px) rotate(${-t * 5 + (t % 2 ? 2 : 0)}deg) scale(${1 - t * 0.06}); z-index:${10 - t}`;
  return `<div class="play-group ${isLatest ? '' : 'old'} ${play.chop ? 'chop' : ''}" style="${style}" data-by="${play.by}">
    <div class="cards"></div>
    <div class="cap">${play.chop ? 'CHOP · ' : ''}<b>${esc(nameOf(play.by))}</b> · ${esc(play.label)}</div></div>`;
}

function fillPile(container, plays) {
  const recent = plays.slice(-4);
  container.innerHTML = recent.map((p, i) => playGroupHTML(p, recent.length - 1 - i, i === recent.length - 1)).join('');
  $$('.play-group', container).forEach((grp, i) => {
    const cards = $('.cards', grp);
    for (const c of recent[i].cards) cards.append(cardEl(c));
  });
}

function flyIn(container, origins) {
  const latest = $$('.play-group', container).at(-1);
  if (!latest) return;
  $$('.card', latest).forEach((el, i) => {
    const from = origins.get(Number(el.dataset.id));
    if (!from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = Math.min(1.2, from.width / to.width);
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${(i - 1) * 7}deg)` }, { transform: 'none' }],
      { duration: 420, delay: i * 25, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' },
    );
  });
}

let pileKey = '';
function renderPile(prev, fx, origins) {
  const g = S.game;
  const pile = $('#pile');
  const plays = g.trick.plays;
  const trickEnded = fx.find((f) => f.type === 'trick');
  const playFx = fx.find((f) => f.type === 'play');

  if (trickEnded) {
    // Show the closing play landing (if any), then sweep the pile off the table.
    const before = prev?.game?.trick?.plays || [];
    const ghostPlays = playFx && !plays.some((p) => p.cards.join() === playFx.cards.join())
      ? [...before, { by: playFx.by, cards: playFx.cards, chop: playFx.chop, label: playFx.label }]
      : before;
    if (ghostPlays.length) {
      const ghost = document.createElement('div');
      ghost.className = 'pile';
      $('#felt').append(ghost);
      fillPile(ghost, ghostPlays);
      if (playFx) flyIn(ghost, origins);
      const winnerSeat = seatEls.get(trickEnded.winner);
      const felt = $('#felt').getBoundingClientRect();
      let sx = 0, sy = felt.height * 0.4;
      if (winnerSeat) {
        const r = winnerSeat.getBoundingClientRect();
        sx = r.left + r.width / 2 - (felt.left + felt.width / 2);
        sy = r.top + r.height / 2 - (felt.top + felt.height / 2);
      }
      ghost.style.setProperty('--sx', `${sx * 0.6}px`);
      ghost.style.setProperty('--sy', `${sy * 0.6}px`);
      setTimeout(() => { ghost.classList.add('sweep'); sfx.sweep(); }, playFx ? 900 : 350);
      setTimeout(() => ghost.remove(), playFx ? 1400 : 850);
    }
  }

  const key = `${g.handNo}:${plays.length}:${plays.at(-1)?.cards.join() ?? ''}`;
  if (key !== pileKey) {
    pileKey = key;
    fillPile(pile, plays);
    if (playFx && !trickEnded) flyIn(pile, origins);
  }

  // center note when the pile is empty
  const note = $('#centerNote');
  let html = '';
  if (g.phase === 'tribute') {
    const t = g.tribute;
    if (t.to === S.me) html = `<span class="big">Tribute!</span>${esc(nameOf(t.from))} paid you their best card${t.given != null ? `<br><span class="tribute-card">${cardEl(t.given).outerHTML}</span>` : ''}<br>Pick a card to hand back.`;
    else if (t.from === S.me) html = `<span class="big">You pay tribute</span>Your best card goes to ${esc(nameOf(t.to))}${t.given != null ? `<br><span class="tribute-card">${cardEl(t.given).outerHTML}</span>` : ''}<br>Waiting for a card back…`;
    else html = `<span class="big">Tribute</span>${esc(nameOf(t.from))} pays ${esc(nameOf(t.to))} their best card.`;
  } else if (g.phase === 'playing' && !plays.length && !trickEnded) {
    if (g.turn === S.me) html = `<span class="big">Your lead</span>${g.mustInclude != null ? `Open with your ${cardTag(g.mustInclude)}.` : 'Play anything.'}`;
    else html = `<span class="big">${esc(nameOf(g.turn))} leads</span>`;
  }
  note.innerHTML = html;
  note.hidden = !html;
}

function renderMe(fx) {
  const g = S.game;
  const meP = player(S.me) || { id: S.me, name: myName, score: 0 };
  $('#meId').innerHTML = `${avatar(meP)}<div><div class="nm">${esc(meP.name)}</div><div class="sub">${fmtPts(meP.score)} pts</div></div>`;

  // ---- hand
  const handBox = $('#hand');
  const hand = g.hand;
  const dealt = fx.some((f) => f.type === 'deal');
  for (const [id, el] of handEls) if (!hand.includes(id)) { el.remove(); handEls.delete(id); selected.delete(id); }
  hand.forEach((c, i) => {
    let el = handEls.get(c);
    if (!el) {
      el = cardEl(c);
      handEls.set(c, el);
      if (dealt) { el.classList.add('deal'); el.style.animationDelay = `${i * 45}ms`; }
    }
    handBox.append(el); // re-appending keeps DOM order == sorted order
  });
  if (dealt) setTimeout(() => handEls.forEach((el) => { el.classList.remove('deal'); el.style.animationDelay = ''; }), 1300);
  const tr = g.tribute;
  for (const [c, el] of handEls) {
    el.classList.toggle('sel', selected.has(c));
    el.classList.toggle('must', g.mustInclude === c && g.turn === S.me);
    el.classList.toggle('gift', !!tr && !tr.done && tr.to === S.me && tr.given === c);
    el.classList.toggle('hint', false);
  }
  layoutHand();

  const myTurn = g.phase === 'playing' && g.turn === S.me;
  const myTribute = g.phase === 'tribute' && tr?.to === S.me;
  handBox.classList.toggle('idle', !myTurn && !myTribute);

  // ---- status line
  const status = $('#statusLine');
  const target = g.trick.plays.at(-1);
  let txt = '';
  if (g.phase === 'over') txt = 'Hand over.';
  else if (myTribute) txt = '<b>Choose a card to give back.</b>';
  else if (g.phase === 'tribute') txt = 'Tribute is being paid…';
  else if (g.finished.includes(S.me)) txt = `You're out — <b>${ordinal(g.finished.indexOf(S.me) + 1)} place</b>. Watch the rest play out.`;
  else if (g.frozen.includes(S.me)) txt = "You're frozen (cóng) — someone went out before you played.";
  else if (myTurn) txt = target ? `<b>Your turn.</b> Beat ${esc(nameOf(target.by))}'s ${esc(target.label)} — or pass.` : '<b>Your lead.</b> Play anything.';
  else if (g.trick.passed.includes(S.me)) txt = `You passed — waiting for this round to end.`;
  else txt = `Waiting for <b>${esc(nameOf(g.turn))}</b>…`;
  status.innerHTML = txt;
  status.classList.toggle('mine', myTurn || myTribute);

  // ---- timer bar
  const bar = $('#timerBar');
  const mine = (myTurn || myTribute) && S.deadline;
  bar.classList.toggle('on', !!mine);
  const i = bar.querySelector('i');
  if (mine) {
    const total = Math.max(S.settings.turnSeconds || 20, myTribute ? 20 : 0) * 1000;
    const left = Math.max(0, S.deadline - now());
    const k = `${S.deadline}`;
    if (i.dataset.k !== k) {
      i.dataset.k = k;
      i.style.animation = 'none';
      void i.offsetWidth;
      i.style.animation = `drain ${total}ms linear ${left - total}ms forwards`;
    }
  } else { i.style.animation = 'none'; i.dataset.k = ''; }

  updateActions();
}

function layoutHand() {
  const box = $('#hand');
  const els = [...handEls.values()];
  if (!els.length) return;
  const cw = els[0].offsetWidth || 80;
  const avail = box.clientWidth - 24;
  const n = els.length;
  const spacing = n > 1 ? Math.min(cw * 0.7, (avail - cw) / (n - 1)) : 0;
  els.forEach((el, i) => { el.style.marginLeft = i === 0 ? '0' : `${spacing - cw}px`; el.style.zIndex = i + 1; });
}
window.addEventListener('resize', layoutHand);

function updateActions() {
  const g = S?.game;
  if (!g) return;
  const playBtn = $('#playBtn');
  const passBtn = $('#passBtn');
  const lbl = $('#playLabel');
  const sel = [...selected].sort((a, b) => a - b);
  const myTribute = g.phase === 'tribute' && g.tribute?.to === S.me;

  if (myTribute) {
    playBtn.firstElementChild.textContent = 'Give back';
    playBtn.disabled = sel.length !== 1;
    lbl.innerHTML = sel.length === 1 ? cardTag(sel[0]).replace(/#ff8a7a/, '#7a1a12') : 'select one card';
    passBtn.disabled = true;
    $('#hintBtn').disabled = true;
    return;
  }
  playBtn.firstElementChild.textContent = 'Play';
  const myTurn = g.phase === 'playing' && g.turn === S.me;
  const target = g.trick.plays.at(-1);
  passBtn.disabled = !myTurn || !target;
  $('#hintBtn').disabled = !myTurn;
  $('#clearBtn').disabled = !sel.length;

  if (!sel.length) { playBtn.disabled = true; lbl.textContent = myTurn ? 'select cards' : ''; return; }
  const combo = analyze(sel);
  if (!combo) { playBtn.disabled = true; lbl.textContent = 'not a valid combo'; return; }
  let ok = myTurn;
  let why = describe(combo);
  if (g.mustInclude != null && myTurn && !sel.includes(g.mustInclude)) { ok = false; why = `must include ${label(g.mustInclude)}`; }
  else if (target && !canBeat(combo, target.combo)) { ok = false; why = `doesn't beat ${target.label}`; }
  playBtn.disabled = !ok;
  lbl.textContent = why;
}

// ---------------------------------------------------------------- hand input
let drag = null;
$('#hand').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.card');
  if (!el) return;
  e.preventDefault();
  const id = Number(el.dataset.id);
  const on = !selected.has(id);
  drag = { on, seen: new Set([id]) };
  setSel(id, on);
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#hand .card');
  if (!el) return;
  const id = Number(el.dataset.id);
  if (drag.seen.has(id)) return;
  drag.seen.add(id);
  setSel(id, drag.on);
});
window.addEventListener('pointerup', () => { drag = null; });

function setSel(id, on) {
  const g = S?.game;
  if (g?.phase === 'tribute' && g.tribute?.to === S.me && on) selected.clear();
  if (on) selected.add(id); else selected.delete(id);
  for (const [c, el] of handEls) { el.classList.toggle('sel', selected.has(c)); el.classList.remove('hint'); }
  sfx.select();
  updateActions();
}

function clearSel() {
  selected.clear();
  for (const el of handEls.values()) el.classList.remove('sel', 'hint');
  updateActions();
}

async function doPlay() {
  const g = S?.game;
  if (!g || $('#playBtn').disabled) return;
  const cards = [...selected];
  if (g.phase === 'tribute') {
    const res = await emit('tribute', cards[0]);
    if (res.ok) selected.clear();
    return;
  }
  const res = await emit('play', cards);
  if (res.ok) { selected.clear(); hints = []; hintIdx = -1; }
}
async function doPass() {
  if ($('#passBtn').disabled) return;
  const res = await emit('pass');
  if (res.ok) clearSel();
}
function doHint() {
  const g = S?.game;
  if (!g || g.turn !== S.me || g.phase !== 'playing') return;
  const target = g.trick.plays.at(-1);
  const key = `${g.hand.join()}|${target?.cards.join()}`;
  if (hints.key !== key) {
    const cost = (p) => p.combo.top + (p.cards.some((c) => rankOf(c) === TWO) ? 100 : 0) + (isBomb(p.combo) ? 200 : 0) - (target ? 0 : p.cards.length * 6);
    hints = legalPlays(g.hand, target?.combo, g.mustInclude).sort((a, b) => cost(a) - cost(b));
    hints.key = key;
    hintIdx = -1;
  }
  if (!hints.length) { toast('Nothing beats that — you have to pass.'); return; }
  hintIdx = (hintIdx + 1) % hints.length;
  selected.clear();
  for (const c of hints[hintIdx].cards) selected.add(c);
  for (const [c, el] of handEls) { el.classList.toggle('sel', selected.has(c)); }
  sfx.select();
  updateActions();
}

$('#playBtn').onclick = doPlay;
$('#passBtn').onclick = doPass;
$('#hintBtn').onclick = doHint;
$('#clearBtn').onclick = clearSel;

document.addEventListener('keydown', (e) => {
  if (currentScreen() !== 'table' || e.target.closest('input, textarea')) return;
  if (e.key === 'Enter') { e.preventDefault(); doPlay(); }
  else if (e.key === 'p' || e.key === 'P') doPass();
  else if (e.key === 'h' || e.key === 'H') doHint();
  else if (e.key === 'Escape') clearSel();
});

// ================================================================= FX
function seatBubble(id, html, ms = 2200) {
  const seat = seatEls.get(id);
  const host = seat || (id === S.me ? $('#me .me-bar') : null);
  if (!host) return;
  host.querySelector(':scope > .bubble')?.remove();
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = html;
  if (!seat) b.style.cssText = 'top:auto;bottom:100%;left:6px;margin:0 0 8px';
  host.append(b);
  setTimeout(() => { b.classList.add('fade'); setTimeout(() => b.remove(), 400); }, ms);
}

function stamp(big, small) {
  const s = $('#stamp');
  s.innerHTML = `${big}<small>${small}</small>`;
  s.classList.remove('go');
  void s.offsetWidth;
  s.classList.add('go');
  const felt = $('#felt');
  felt.classList.remove('shake');
  void felt.offsetWidth;
  felt.classList.add('shake');
}

function handleFx(prev, fx) {
  const g = S.game;
  for (const f of fx) {
    switch (f.type) {
      case 'deal': sfx.deal(); break;
      case 'play':
        sfx.play(f.cards.length);
        if (f.chop) setTimeout(() => sfx.chop(), 250);
        break;
      case 'chop':
        setTimeout(() => stamp('CHẶT!', `${esc(nameOf(f.by))} chopped ${esc(nameOf(f.victim))}${f.value ? ` · ${f.value} pt${f.value > 1 ? 's' : ''}` : ''}`), 200);
        break;
      case 'pass': sfx.pass(); seatBubble(f.id, 'Pass', 1400); break;
      case 'out':
        sfx.out();
        toast(`${f.id === S.me ? 'You are' : `${esc(nameOf(f.id))} is`} out — <b>${ordinal(f.place)}</b>`, '', 2600);
        break;
      case 'frozen': toast(`${f.id === S.me ? "You're" : `${esc(nameOf(f.id))} is`} frozen — <b>cóng!</b>`, 'err', 3000); break;
      case 'instant': toast(`<b>${esc(nameOf(f.id))}</b> wins on the deal — ${esc(f.reason)}!`, '', 4000); break;
      case 'tributeAsk':
        if (f.to === S.me) toast(`${esc(nameOf(f.from))} owes you tribute.`);
        else if (f.from === S.me) toast(`You finished last — tribute goes to ${esc(nameOf(f.to))}.`, 'err');
        break;
      case 'tribute':
        if (f.from === S.me && f.returned != null) toast(`${esc(nameOf(f.to))} handed you back the ${cardTag(f.returned)}`);
        break;
      case 'over':
        if (f.placings[0] === S.me) sfx.win(); else sfx.out();
        break;
      case 'chat':
        if (f.id !== S.me) { sfx.chat(); seatBubble(f.id, esc(f.text), 4000); if (tab !== 'chat' || !$('#side').classList.contains('open')) { unread++; $('#chatDot').hidden = false; } }
        else seatBubble(f.id, esc(f.text), 3000);
        break;
    }
  }
  // your-turn cue
  const wasMine = prev?.game?.turn === S.me && prev?.game?.phase === 'playing';
  const isMine = g?.turn === S.me && g?.phase === 'playing';
  if (isMine && !wasMine) {
    setTimeout(() => sfx.turn(), 300);
    if (document.hidden) document.title = '▶ Your turn — Thirteen';
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Thirteen — Tiến Lên with friends'; });

// ================================================================= FEEDS
function renderFeeds() {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const log = $('#logFeed');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.innerHTML = S.log.map((l) => `<li class="${l.kind}"><time>${t(l.t)}</time>${esc(l.text)}</li>`).join('');
  if (atBottom) log.scrollTop = log.scrollHeight;
  const chat = $('#chatFeed');
  chat.innerHTML = S.chat.length
    ? S.chat.map((c) => `<li><time>${t(c.t)}</time><span class="who">${esc(c.from)}</span> ${esc(c.text)}</li>`).join('')
    : '<li class="muted">No messages yet. Say hi.</li>';
  chat.scrollTop = chat.scrollHeight;
}

$$('.tab').forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
  $('#logFeed').hidden = tab !== 'log';
  $('#chatFeed').hidden = tab !== 'chat';
  $('#chatForm').hidden = tab !== 'chat';
  if (tab === 'chat') { unread = 0; $('#chatDot').hidden = true; $('#chatFeed').scrollTop = 1e9; $('#chatInput').focus(); }
}));
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (!v) return;
  socket.emit('chat', v);
  $('#chatInput').value = '';
};
$('#sideToggle').onclick = () => {
  $('#side').classList.toggle('open');
  if ($('#side').classList.contains('open') && tab === 'chat') { unread = 0; $('#chatDot').hidden = true; }
};

// ================================================================= RESULTS
function renderResults() {
  const g = S.game;
  const modal = $('#resultsModal');
  if (g.phase !== 'over' || resultsSeenFor === g.handNo || !g.result) { modal.hidden = true; return; }
  if (!modal.hidden) { renderResultButtons(); return; }
  const r = g.result;
  const winner = r.placings[0];
  $('#resultsEyebrow').textContent = `Hand #${g.handNo}`;
  $('#resultsTitle').textContent = winner === S.me ? 'You win the hand!' : `${nameOf(winner)} wins the hand`;
  $('#resultsSub').textContent = r.instant ? `Instant win — ${r.instant.reason}.` : g.frozen.length ? `${g.frozen.map(nameOf).join(', ')} got frozen.` : '';
  $('#placings').innerHTML = r.placings.map((id, i) => {
    const p = player(id) || { id, name: '—', score: 0 };
    const left = r.leftovers?.[id] || [];
    return `<li style="animation-delay:${i * 80}ms"><span class="medal">${ordinal(i + 1)}</span>${avatar(p)}
      <span class="nm">${esc(id === S.me ? `${p.name} (you)` : p.name)}<small>total ${fmtPts(p.score)}</small></span>
      <span class="left">${left.map((c) => cardEl(c).outerHTML).join('')}</span>
      <span class="delta pts ${ptsClass(r.delta[id])}">${fmtPts(r.delta[id])}</span></li>`;
  }).join('');
  $('#ledger').innerHTML = r.ledger.map((l) => `<li>${esc(nameOf(l.from))} paid ${esc(nameOf(l.to))} ${l.amount} — ${esc(l.why)}</li>`).join('');
  modal.hidden = false;
  renderResultButtons();
}

function renderResultButtons() {
  const isHost = S.hostId === S.me;
  $('#nextHandBtn').hidden = !isHost;
  $('#nextHandBtn').disabled = S.players.length < 2;
  $('#resultsWait').textContent = isHost ? '' : `Waiting for ${player(S.hostId)?.name ?? 'the host'} to deal the next hand…`;
}

$('#nextHandBtn').onclick = () => emit('start');
$('#toLobbyBtn').onclick = () => {
  resultsSeenFor = S.game.handNo;
  lobbyOverride = true;
  $('#resultsModal').hidden = true;
  render(S, [], new Map());
};
$('#startBtn').onclick = () => emit('start');

// ================================================================= CHROME
$$('[data-open]').forEach((b) => (b.onclick = () => ($('#' + b.dataset.open).hidden = false)));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => {
  if (e.target === m && m.id !== 'resultsModal') m.hidden = true;
  if (e.target.closest('[data-close]')) m.hidden = true;
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#rulesModal').hidden = true; });
$$('[data-action="leave"]').forEach((b) => (b.onclick = () => {
  const g = S?.game;
  if (g && g.phase !== 'over' && g.order.includes(S.me) && !confirm('Leave mid-hand? The house will play out your cards.')) return;
  leaveRoom();
}));
for (const id of ['#lobbyCode', '#tableCode', '#copyLink']) $(id).onclick = () => copy(inviteLink(), 'Invite link copied — send it to your friends.');
$('#copyCode').onclick = () => copy(roomCode, 'Code copied.');
$('#soundBtn').onclick = () => { toggleMute(); $('#soundBtn').textContent = isMuted() ? '♪̸' : '♪'; };

// ================================================================= BOOT
initHome();
show('home');
