// Tiến Lên Miền Nam (Southern "Thirteen") — pure rules engine.
// Shared by the server (authoritative) and the browser (hints / live validation).
//
// Card encoding: id = rank * 4 + suit, so a plain numeric compare is the game's ordering.
//   rank 0..12 => 3 4 5 6 7 8 9 10 J Q K A 2
//   suit 0..3  => ♠ ♣ ♦ ♥   (spades lowest, hearts highest)

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['♠', '♣', '♦', '♥'];
export const SUIT_NAMES = ['spades', 'clubs', 'diamonds', 'hearts'];
export const TWO = 12;
export const THREE_OF_SPADES = 0;

export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const isRed = (c) => suitOf(c) >= 2;
export const label = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];
export const sortCards = (cards) => [...cards].sort((a, b) => a - b);

export function newDeck() {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const COMBO_NAMES = {
  single: 'Single',
  pair: 'Pair',
  triple: 'Triple',
  quad: 'Four of a kind',
  straight: 'Straight',
  pairseq: 'Consecutive pairs',
};

/** Identify a set of cards as a legal combination, or null. */
export function analyze(cards) {
  const cs = sortCards(cards);
  const n = cs.length;
  if (!n || new Set(cs).size !== n || cs.some((c) => c < 0 || c > 51)) return null;
  const ranks = cs.map(rankOf);
  const top = cs[n - 1];

  if (n === 1) return { type: 'single', len: 1, top };
  if (n <= 4 && ranks.every((r) => r === ranks[0])) {
    return { type: [null, 'single', 'pair', 'triple', 'quad'][n], len: n, top };
  }
  // 2s can never be part of a run.
  if (ranks[n - 1] === TWO) return null;

  if (n >= 3) {
    let run = true;
    for (let i = 1; i < n; i++) if (ranks[i] !== ranks[i - 1] + 1) run = false;
    if (run) return { type: 'straight', len: n, top };
  }
  if (n >= 6 && n % 2 === 0) {
    let ok = true;
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1]) ok = false;
      if (i > 0 && ranks[i] !== ranks[i - 2] + 1) ok = false;
    }
    if (ok) return { type: 'pairseq', len: n, top };
  }
  return null;
}

export function describe(combo) {
  if (!combo) return 'Invalid';
  const t = combo.top;
  switch (combo.type) {
    case 'single': return label(t);
    case 'pair': return `Pair of ${RANKS[rankOf(t)]}s`;
    case 'triple': return `Three ${RANKS[rankOf(t)]}s`;
    case 'quad': return `Four ${RANKS[rankOf(t)]}s`;
    case 'straight': return `Straight ${RANKS[rankOf(t) - combo.len + 1]}–${RANKS[rankOf(t)]}`;
    case 'pairseq': return `${combo.len / 2} consecutive pairs`;
  }
  return 'Invalid';
}

const pairsIn = (c) => (c.type === 'pairseq' ? c.len / 2 : 0);
const isTwos = (c) => rankOf(c.top) === TWO && ['single', 'pair', 'triple'].includes(c.type);

/**
 * Can combo `p` be played on top of combo `t`?
 * Normal beats: same shape, same length, higher top card (rank, then suit).
 * Chops ("chặt heo"):
 *   single 2         <- four of a kind, 3+ consecutive pairs
 *   pair of 2s       <- four of a kind, 4+ consecutive pairs
 *   three 2s         <- 5+ consecutive pairs
 *   3 consec. pairs  <- four of a kind, 4+ consecutive pairs
 *   four of a kind   <- 4+ consecutive pairs (or a higher four of a kind)
 *   N consec. pairs  <- more consecutive pairs (N >= 4)
 */
export function canBeat(p, t) {
  if (!p) return false;
  if (!t) return true;
  if (p.type === t.type && p.len === t.len) return p.top > t.top;
  const pp = pairsIn(p);
  if (isTwos(t)) {
    if (t.type === 'single') return p.type === 'quad' || pp >= 3;
    if (t.type === 'pair') return p.type === 'quad' || pp >= 4;
    if (t.type === 'triple') return pp >= 5;
  }
  if (t.type === 'pairseq' && t.len === 6) return p.type === 'quad' || pp >= 4;
  if (t.type === 'quad') return pp >= 4;
  if (t.type === 'pairseq' && t.len >= 8) return pp > t.len / 2;
  return false;
}

export const isBomb = (c) => !!c && (c.type === 'quad' || (c.type === 'pairseq' && c.len >= 6));

/** Is playing `p` on `t` a chop (a bomb landing on 2s or on another bomb)? */
export function isChop(p, t, tWasChop = false) {
  if (!p || !t) return false;
  if (p.type !== t.type || p.len !== t.len) return true;
  return isBomb(t) && tWasChop;
}

/** Penalty value of the thing that got chopped. */
export function chopValue(cards, combo) {
  if (isTwos(combo)) return cards.reduce((s, c) => s + (isRed(c) ? 2 : 1), 0);
  if (combo.type === 'pairseq') return combo.len === 6 ? 3 : combo.len === 8 ? 6 : 8;
  if (combo.type === 'quad') return 4;
  return 0;
}

/** "Tới trắng" — instant win from the deal. Returns a reason or null. */
export function findInstantWin(hand) {
  const counts = Array(13).fill(0);
  for (const c of hand) counts[rankOf(c)]++;
  if (counts[TWO] === 4) return 'Four 2s';
  if (counts.slice(0, 12).every((n) => n >= 1)) return 'Dragon (3 through A)';
  if (counts.reduce((s, n) => s + Math.floor(n / 2), 0) >= 6) return 'Six pairs';
  let run = 0;
  for (let r = 0; r < 12; r++) {
    run = counts[r] >= 2 ? run + 1 : 0;
    if (run >= 5) return 'Five consecutive pairs';
  }
  return null;
}

function combos(arr, k) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) return out.push([...acc]);
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

/**
 * Every reasonable play from a hand (used for hints and bots). Runs use the lowest
 * cards for the lower ranks and every option for the top rank, which covers all
 * distinct ways of beating a given target without combinatorial blow-up.
 */
export function allPlays(hand) {
  const byRank = Array.from({ length: 13 }, () => []);
  for (const c of sortCards(hand)) byRank[rankOf(c)].push(c);
  const out = [];
  const add = (cards) => { const combo = analyze(cards); if (combo) out.push({ cards: sortCards(cards), combo }); };

  for (let r = 0; r < 13; r++) {
    const g = byRank[r];
    for (let k = 1; k <= Math.min(4, g.length); k++) for (const cs of combos(g, k)) add(cs);
  }
  for (let s = 0; s < 12; s++) {
    const base = [];
    for (let e = s; e < 12 && byRank[e].length; e++) {
      if (e - s >= 2) for (const top of byRank[e]) add([...base, top]);
      base.push(byRank[e][0]);
    }
  }
  for (let s = 0; s < 12; s++) {
    const base = [];
    for (let e = s; e < 12 && byRank[e].length >= 2; e++) {
      if (e - s >= 2) for (const pair of combos(byRank[e], 2)) add([...base, ...pair]);
      base.push(byRank[e][0], byRank[e][1]);
    }
  }
  return out;
}

export function legalPlays(hand, target, mustInclude = null) {
  return allPlays(hand).filter(
    (p) => canBeat(p.combo, target) && (mustInclude == null || p.cards.includes(mustInclude)),
  );
}

/** Placement points by table size: 1st, 2nd, ... */
export function placementPoints(n) {
  return { 2: [1, -1], 3: [2, 0, -2], 4: [3, 1, -1, -3] }[n] || Array(n).fill(0);
}
