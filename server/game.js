import {
  analyze, canBeat, isChop, chopValue, findInstantWin, newDeck, shuffle, sortCards,
  rankOf, isRed, TWO, THREE_OF_SPADES, describe, placementPoints, label,
} from '../shared/rules.js';

export const DEFAULT_SETTINGS = {
  tribute: true,          // loser hands their best card to the winner, winner hands one back
  winnerLeads: true,      // after hand 1 the previous winner leads; otherwise lowest card leads
  firstLeadLowest: true,  // the opening play of a lowest-card lead must include that card (3♠)
  instantWin: true,       // "tới trắng": four 2s, dragon, six pairs, five consecutive pairs
  chopPenalty: true,      // getting your 2s / bombs chopped costs points
  stuckTwoPenalty: true,  // "thối heo": last place pays for 2s left in hand
  frozenPenalty: true,    // "cóng": not playing a single card before someone goes out
  turnSeconds: 30,        // 0 = no timer
};

/**
 * One hand of Tiến Lên. Players are given in seat order (clockwise).
 * Every mutating method returns { ok, error?, fx: [...] } where fx are visual/audio events.
 */
export class Game {
  constructor(players, settings, { prevWinner = null, prevLoser = null, handNo = 1, rng = Math.random } = {}) {
    this.order = players.map((p) => p.id);
    this.names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.handNo = handNo;
    this.rng = rng;
    this.hands = {};
    this.played = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.finished = [];
    this.frozen = [];
    this.trick = this.emptyTrick();
    this.turn = null;
    this.mustInclude = null;
    this.delta = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.ledger = [];
    this.result = null;
    this.tribute = null;
    this.prevWinner = this.order.includes(prevWinner) ? prevWinner : null;
    this.prevLoser = this.order.includes(prevLoser) ? prevLoser : null;
    this.deal();
  }

  emptyTrick() {
    return { plays: [], passed: [], lastChop: false };
  }

  deal() {
    const deck = shuffle(newDeck(), this.rng);
    this.order.forEach((id, i) => { this.hands[id] = sortCards(deck.slice(i * 13, i * 13 + 13)); });
    const s = this.settings;
    if (s.tribute && this.prevWinner && this.prevLoser && this.prevWinner !== this.prevLoser) {
      const best = this.hands[this.prevLoser].at(-1);
      this.move(this.prevLoser, this.prevWinner, best);
      this.phase = 'tribute';
      this.tribute = { from: this.prevLoser, to: this.prevWinner, given: best, returned: null };
      return;
    }
    this.begin();
  }

  move(from, to, card) {
    this.hands[from] = this.hands[from].filter((c) => c !== card);
    this.hands[to] = sortCards([...this.hands[to], card]);
  }

  /** The winner hands one card back to the loser. */
  returnTribute(id, card) {
    if (this.phase !== 'tribute' || id !== this.tribute.to) return { ok: false, error: 'Not your tribute to give.' };
    if (!this.hands[id].includes(card)) return { ok: false, error: "You don't have that card." };
    this.move(id, this.tribute.from, card);
    this.tribute.returned = card;
    return { ok: true, fx: [{ type: 'tribute', from: this.tribute.from, to: id, ...this.tribute }, ...this.begin()] };
  }

  begin() {
    this.phase = 'playing';
    const fx = [];
    if (this.settings.instantWin) {
      for (const id of this.order) {
        const why = findInstantWin(this.hands[id]);
        if (why) {
          this.finishInstant(id, why);
          return [{ type: 'instant', id, reason: why }];
        }
      }
    }
    const lowestHolder = () => {
      let best = null;
      for (const id of this.order) if (best == null || this.hands[id][0] < this.hands[best][0]) best = id;
      return best;
    };
    if (this.handNo > 1 && this.settings.winnerLeads && this.prevWinner) {
      this.turn = this.prevWinner;
    } else {
      this.turn = lowestHolder();
      if (this.settings.firstLeadLowest) this.mustInclude = this.hands[this.turn][0];
    }
    fx.push({ type: 'start', id: this.turn, mustInclude: this.mustInclude });
    return fx;
  }

  get active() {
    return this.order.filter((id) => !this.finished.includes(id) && !this.frozen.includes(id));
  }

  get target() {
    return this.trick.plays.at(-1) || null;
  }

  /** Check whether `cards` would be a legal play for `id` right now (no mutation). */
  validate(id, cards) {
    if (this.phase !== 'playing') return 'The hand is not in play.';
    if (id !== this.turn) return "It's not your turn.";
    if (!Array.isArray(cards) || !cards.length) return 'Select some cards first.';
    const hand = this.hands[id];
    if (!cards.every((c) => hand.includes(c))) return "You don't hold those cards.";
    const combo = analyze(cards);
    if (!combo) return "That's not a valid combination.";
    if (this.mustInclude != null && !cards.includes(this.mustInclude)) {
      return `The opening play must include the ${label(this.mustInclude)}.`;
    }
    const t = this.target;
    if (t && !canBeat(combo, t.combo)) return `${describe(combo)} doesn't beat ${describe(t.combo)}.`;
    return null;
  }

  play(id, cards) {
    const err = this.validate(id, cards);
    if (err) return { ok: false, error: err };
    cards = sortCards(cards);
    const combo = analyze(cards);
    const t = this.target;
    const fx = [];
    const chop = t && isChop(combo, t.combo, this.trick.lastChop);
    const entry = { by: id, cards, combo, chop: !!chop, label: describe(combo) };

    if (chop) {
      const value = chopValue(t.cards, t.combo) + (this.trick.lastChop ? t.stake || 0 : 0);
      entry.stake = value;
      if (this.settings.chopPenalty && value > 0) this.pay(t.by, id, value, `chopped ${t.label}`);
      fx.push({ type: 'chop', by: id, victim: t.by, value, label: entry.label });
    }
    this.trick.lastChop = !!chop;
    this.trick.plays.push(entry);
    this.hands[id] = this.hands[id].filter((c) => !cards.includes(c));
    this.played[id] += cards.length;
    this.mustInclude = null;
    fx.unshift({ type: 'play', by: id, cards, label: entry.label, chop: !!chop });

    if (!this.hands[id].length) {
      this.finished.push(id);
      fx.push({ type: 'out', id, place: this.finished.length });
      if (this.finished.length === 1 && this.settings.frozenPenalty) {
        for (const other of this.order) {
          if (other !== id && this.played[other] === 0) {
            this.frozen.push(other);
            fx.push({ type: 'frozen', id: other });
          }
        }
      }
    }
    fx.push(...this.advance(id));
    return { ok: true, fx };
  }

  pass(id) {
    if (this.phase !== 'playing') return { ok: false, error: 'The hand is not in play.' };
    if (id !== this.turn) return { ok: false, error: "It's not your turn." };
    if (!this.target) return { ok: false, error: "You're leading — you can't pass." };
    this.trick.passed.push(id);
    return { ok: true, fx: [{ type: 'pass', id }, ...this.advance(id)] };
  }

  nextAfter(id, pool) {
    const i = this.order.indexOf(id);
    for (let k = 1; k <= this.order.length; k++) {
      const cand = this.order[(i + k) % this.order.length];
      if (pool.includes(cand)) return cand;
    }
    return null;
  }

  advance(actor) {
    const active = this.active;
    if (active.length <= 1) return this.finishHand();
    const t = this.target;
    const contenders = active.filter((p) => p !== t.by && !this.trick.passed.includes(p));
    if (!contenders.length) {
      // Everyone passed: the last player to play leads. If they went out, the next player on leads.
      const leader = active.includes(t.by) ? t.by : this.nextAfter(t.by, active);
      this.trick = this.emptyTrick();
      this.turn = leader;
      return [{ type: 'trick', winner: t.by, leader }];
    }
    this.turn = this.nextAfter(actor, contenders);
    return [];
  }

  pay(from, to, amount, why) {
    this.delta[from] -= amount;
    this.delta[to] += amount;
    this.ledger.push({ from, to, amount, why });
  }

  finishInstant(id, reason) {
    this.finished = [id];
    for (const other of this.order) if (other !== id) this.pay(other, id, 2, `instant win (${reason})`);
    this.finished.push(...this.order.filter((p) => p !== id));
    this.phase = 'over';
    this.turn = null;
    this.result = { placings: [...this.finished], instant: { id, reason }, delta: this.delta, ledger: this.ledger };
  }

  finishHand() {
    const active = this.active;
    // Remaining player(s) take the next places, frozen players come dead last.
    this.finished.push(...active, ...this.frozen);
    const placings = this.finished;
    const pts = placementPoints(placings.length);
    placings.forEach((id, i) => { this.delta[id] += pts[i]; });
    const winner = placings[0];
    const loser = placings.at(-1);
    if (this.settings.frozenPenalty) {
      for (const f of this.frozen) this.pay(f, winner, 2, 'frozen (cóng)');
    }
    if (this.settings.stuckTwoPenalty) {
      const twos = this.hands[loser].filter((c) => rankOf(c) === TWO);
      const v = twos.reduce((s, c) => s + (isRed(c) ? 2 : 1), 0);
      if (v) this.pay(loser, winner, v, `stuck with ${twos.map(label).join(' ')}`);
    }
    this.phase = 'over';
    this.turn = null;
    this.result = { placings, frozen: [...this.frozen], delta: this.delta, ledger: this.ledger, leftovers: { ...this.hands } };
    return [{ type: 'over', placings }];
  }

  /** Auto move on timeout / for absent players: pass if possible, else lead the lowest card. */
  autoMove(id) {
    if (this.phase === 'tribute' && id === this.tribute?.to) return this.returnTribute(id, this.hands[id][0]);
    if (this.phase !== 'playing' || id !== this.turn) return { ok: false };
    if (this.target) return this.pass(id);
    return this.play(id, [this.mustInclude ?? this.hands[id][0]]);
  }

  /** Public view of the hand for one viewer (only their own cards are revealed). */
  view(viewer) {
    const over = this.phase === 'over';
    return {
      phase: this.phase,
      handNo: this.handNo,
      order: this.order,
      turn: this.turn,
      mustInclude: this.turn === viewer ? this.mustInclude : null,
      hand: this.hands[viewer] || [],
      counts: Object.fromEntries(this.order.map((id) => [id, this.hands[id].length])),
      played: this.played,
      trick: {
        plays: this.trick.plays.map(({ by, cards, combo, chop, label: l }) => ({ by, cards, combo, chop, label: l })),
        passed: this.trick.passed,
      },
      finished: this.finished,
      frozen: this.frozen,
      tribute: this.tribute && {
        from: this.tribute.from, to: this.tribute.to,
        given: this.tribute.to === viewer || this.tribute.from === viewer || over ? this.tribute.given : null,
        returned: this.tribute.returned != null && (this.tribute.from === viewer || this.tribute.to === viewer) ? this.tribute.returned : null,
        done: this.tribute.returned != null,
      },
      delta: this.delta,
      result: over ? this.result : null,
    };
  }
}
