import { Game, DEFAULT_SETTINGS } from './game.js';
import { chooseMove } from './bot.js';

const BOT_NAMES = ['Bà Tư', 'Chú Sáu', 'Cô Ba', 'Anh Hai', 'Ông Năm', 'Dì Bảy'];
const MAX_PLAYERS = 4;
const AWAY_SECONDS = 20; // turn length for disconnected players when no timer is set
const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS) || 60_000; // disconnected this long mid-hand = left

let nextId = 1;
const uid = (p) => `${p}${(nextId++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class Room {
  constructor(code, onChange) {
    this.code = code;
    this.players = [];        // { id, token, name, isBot, connected, sockets:Set }
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.scores = {};
    this.game = null;
    this.handNo = 0;
    this.lastWinner = null;
    this.lastLoser = null;
    this.chat = [];
    this.log = [];
    this.timer = null;
    this.deadline = null;
    this.onChange = onChange;  // (room, fx[]) => broadcast
    this.emptySince = null;
  }

  get humans() { return this.players.filter((p) => !p.isBot); }
  player(id) { return this.players.find((p) => p.id === id); }
  byToken(token) { return this.players.find((p) => p.token === token && !p.isBot); }

  join(token, name) {
    let p = this.byToken(token);
    if (p) {
      p.name = name || p.name;
      p.left = false;
      return { player: p };
    }
    if (this.game && this.game.phase !== 'over') return { error: 'A hand is in progress — wait for it to finish.' };
    // Replace a bot seat if the table is full of bots.
    if (this.players.length >= MAX_PLAYERS) {
      const bot = [...this.players].reverse().find((x) => x.isBot);
      if (!bot) return { error: 'This table is full (4 players).' };
      this.removePlayer(bot.id);
    }
    p = { id: uid('p'), token, name: name || 'Player', isBot: false, connected: true };
    this.players.push(p);
    this.scores[p.id] = 0;
    if (!this.hostId) this.hostId = p.id;
    this.addLog(`${p.name} sat down.`);
    return { player: p };
  }

  addBot() {
    if (this.players.length >= MAX_PLAYERS) return 'The table is full.';
    if (this.game && this.game.phase !== 'over') return 'Wait for the hand to finish.';
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${this.players.length + 1}`;
    const p = { id: uid('b'), token: null, name, isBot: true, connected: true };
    this.players.push(p);
    this.scores[p.id] = 0;
    this.addLog(`${name} (bot) sat down.`);
    return null;
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.game && this.game.phase !== 'over' && this.game.order.includes(id)) {
      // Mid-hand: keep the seat but let the house play it out.
      p.left = true;
      p.connected = false;
      if (this.hostId === id) this.passHost(id);
      const staying = this.game.order.filter((pid) => !this.player(pid)?.left);
      if (staying.length === 1) {
        this.addLog(`${p.name} left the table.`);
        const fx = this.game.endByForfeit(staying[0]);
        for (const f of fx) this.describeFx(f);
        this.afterHand(this.game.result);
        this.commit(fx);
        return;
      }
      this.addLog(`${p.name} left — the house will play their hand.`);
      this.schedule();
      return;
    }
    this.players = this.players.filter((x) => x.id !== id);
    delete this.scores[id];
    if (!p.isBot) this.addLog(`${p.name} left the table.`);
    if (this.hostId === id) this.passHost(id);
  }

  /**
   * A player's last connection dropped. Mid-hand they get a grace period to come back
   * (refresh, flaky Wi-Fi); after that they count as having left the table.
   */
  markAway(id) {
    const p = this.player(id);
    if (!p || p.isBot) return;
    clearTimeout(p.awayTimer);
    p.awayTimer = setTimeout(() => {
      const g = this.game;
      if (p.connected || !this.players.includes(p) || p.left) return;
      if (!g || g.phase === 'over' || !g.order.includes(id)) return;
      this.addLog(`${p.name} didn't come back.`);
      this.removePlayer(id);
      this.commit();
    }, LEAVE_GRACE_MS);
    p.awayTimer.unref?.();
  }

  passHost(fromId) {
    this.hostId = this.humans.find((h) => !h.left && h.id !== fromId)?.id || null;
    if (this.hostId) this.addLog(`${this.player(this.hostId).name} is now the host.`);
  }

  /** Drop players that left mid-hand once the hand is over. */
  sweepLeavers() {
    for (const p of [...this.players]) if (p.left) this.removePlayer(p.id);
  }

  updateSettings(patch) {
    if (this.game && this.game.phase !== 'over') return 'Rules can only be changed between hands.';
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in patch) {
        const v = patch[k];
        if (k === 'turnSeconds') {
          if ([0, 15, 20, 30, 45, 60].includes(Number(v))) this.settings.turnSeconds = Number(v);
        } else this.settings[k] = !!v;
      }
    }
    return null;
  }

  start() {
    if (this.players.length < 2) return 'You need at least 2 players.';
    if (this.game && this.game.phase !== 'over') return 'A hand is already in progress.';
    this.sweepLeavers();
    if (this.players.length < 2) return 'You need at least 2 players.';
    this.handNo += 1;
    const isNewTable = this.game == null;
    this.game = new Game(this.players, this.settings, {
      handNo: this.handNo,
      prevWinner: isNewTable ? null : this.lastWinner,
      prevLoser: isNewTable ? null : this.lastLoser,
    });
    this.addLog(`Hand #${this.handNo} dealt.`);
    for (const p of this.humans) if (!p.connected) this.markAway(p.id);
    const fx = [{ type: 'deal', handNo: this.handNo }];
    if (this.game.phase === 'tribute') {
      const t = this.game.tribute;
      this.addLog(`${this.name(t.from)} pays tribute to ${this.name(t.to)}.`);
      fx.push({ type: 'tributeAsk', from: t.from, to: t.to });
    } else if (this.game.phase === 'over') {
      this.afterHand(this.game.result);
      fx.push({ type: 'instant', id: this.game.result.instant.id, reason: this.game.result.instant.reason });
    }
    this.commit(fx);
    return null;
  }

  name(id) { return this.player(id)?.name ?? '?'; }

  act(id, action, payload) {
    const g = this.game;
    if (!g) return 'No hand in progress.';
    let res;
    if (action === 'play') res = g.play(id, payload);
    else if (action === 'pass') res = g.pass(id);
    else if (action === 'tribute') res = g.returnTribute(id, payload);
    else if (action === 'auto') res = g.autoMove(id);
    if (!res?.ok) return res?.error || 'Not allowed.';
    for (const f of res.fx) this.describeFx(f);
    if (g.phase === 'over' && !this.resultApplied) this.afterHand(g.result);
    this.commit(res.fx);
    return null;
  }

  describeFx(f) {
    const n = (id) => this.name(id);
    if (f.type === 'play') this.addLog(`${n(f.by)} played ${f.label}.`);
    if (f.type === 'chop') this.addLog(`${n(f.by)} CHOPPED ${n(f.victim)}!${f.value ? ` (−${f.value})` : ''}`, 'chop');
    if (f.type === 'out') this.addLog(`${n(f.id)} is out — ${ordinal(f.place)} place.`, 'good');
    if (f.type === 'frozen') this.addLog(`${n(f.id)} is frozen (cóng) — never played a card.`, 'bad');
    if (f.type === 'instant') this.addLog(`${n(f.id)} wins instantly: ${f.reason}!`, 'good');
    if (f.type === 'forfeit') this.addLog(`Everyone else left — ${n(f.id)} wins the hand by default.`, 'good');
    if (f.type === 'tribute') this.addLog(`${n(f.to)} handed a card back to ${n(f.from)}.`);
  }

  afterHand(result) {
    this.resultApplied = true;
    for (const [id, d] of Object.entries(result.delta)) this.scores[id] = (this.scores[id] || 0) + d;
    this.lastWinner = result.placings[0];
    this.lastLoser = result.placings.at(-1);
    this.addLog(`Hand #${this.handNo} over — ${this.name(this.lastWinner)} wins.`, 'good');
  }

  commit(fx = []) {
    if (this.game?.phase !== 'over') this.resultApplied = false;
    this.schedule();
    this.onChange(this, fx);
  }

  /** Arm the turn timer / bot thinking timer for whoever is to act. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
    const g = this.game;
    if (!g || g.phase === 'over') return;
    const actor = g.phase === 'tribute' ? g.tribute.to : g.turn;
    const p = this.player(actor);
    if (!p) return;
    if (p.isBot || p.left) {
      const delay = p.left ? 900 : 700 + Math.random() * 900;
      this.timer = setTimeout(() => this.botMove(actor), delay);
      return;
    }
    const secs = this.settings.turnSeconds || (p.connected ? 0 : AWAY_SECONDS);
    if (!secs) return;
    const ms = (g.phase === 'tribute' ? Math.max(secs, 20) : secs) * 1000;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this.act(actor, 'auto'), ms);
  }

  botMove(id) {
    const g = this.game;
    if (!g) return;
    if (g.phase === 'tribute') {
      // Give back the lowest card that isn't part of a pair.
      const h = g.hands[id];
      const lone = h.find((c) => h.filter((x) => x >> 2 === c >> 2).length === 1) ?? h[0];
      this.act(id, 'tribute', lone);
      return;
    }
    if (g.turn !== id) return;
    const move = chooseMove(g, id);
    const err = move ? this.act(id, 'play', move) : this.act(id, 'pass');
    if (err) this.act(id, 'auto');
  }

  addLog(text, kind = '') {
    this.log.push({ t: Date.now(), text, kind });
    if (this.log.length > 60) this.log.shift();
  }

  addChat(id, text) {
    const p = this.player(id);
    text = String(text || '').trim().slice(0, 200);
    if (!p || !text) return;
    this.chat.push({ t: Date.now(), from: p.name, id, text });
    if (this.chat.length > 50) this.chat.shift();
    this.onChange(this, [{ type: 'chat', id, text }]);
  }

  view(viewerId) {
    return {
      code: this.code,
      me: viewerId,
      hostId: this.hostId,
      settings: this.settings,
      handNo: this.handNo,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected, left: !!p.left, score: this.scores[p.id] || 0,
      })),
      game: this.game ? this.game.view(viewerId) : null,
      deadline: this.deadline,
      now: Date.now(),
      log: this.log.slice(-30),
      chat: this.chat.slice(-30),
    };
  }

  destroy() {
    clearTimeout(this.timer);
    for (const p of this.players) clearTimeout(p.awayTimer);
  }
}

function ordinal(n) {
  return n + (['th', 'st', 'nd', 'rd'][n] || 'th');
}
