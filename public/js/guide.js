// Slide-out "Hand guide": every play in Tiến Lên ranked from strongest to weakest,
// with live markers for what you're holding and what's on the table.
import { allPlays, rankOf, TWO } from '/shared/rules.js';
import { cardEl } from './cards.js';

// card id = rank * 4 + suit; ranks 3..2 => 0..12, suits ♠♣♦♥ => 0..3
const c = (rank, suit) => rank * 4 + suit;

/** Which guide row a combo belongs to (1 = strongest). */
export function tierOf(combo) {
  if (!combo) return null;
  const two = rankOf(combo.top) === TWO;
  switch (combo.type) {
    case 'pairseq': return combo.len >= 8 ? 1 : 3;
    case 'quad': return 2;
    case 'triple': return two ? 4 : 7;
    case 'pair': return two ? 5 : 9;
    case 'single': return two ? 6 : 10;
    case 'straight': return 8;
  }
  return null;
}

const TIERS = [
  {
    n: 1, name: 'Four consecutive pairs', vi: 'bốn đôi thông', kind: 'bomb',
    cards: [c(2, 0), c(2, 3), c(3, 1), c(3, 2), c(4, 0), c(4, 3), c(5, 1), c(5, 3)],
    beats: 'Four of a kind, 3 consecutive pairs, a pair of 2s, a single 2. Only a higher (or longer) run of pairs beats it.',
  },
  {
    n: 2, name: 'Four of a kind', vi: 'tứ quý', kind: 'bomb',
    cards: [c(6, 0), c(6, 1), c(6, 2), c(6, 3)],
    beats: 'A single 2, a pair of 2s, 3 consecutive pairs, or a lower four of a kind.',
  },
  {
    n: 3, name: 'Three consecutive pairs', vi: 'ba đôi thông', kind: 'bomb',
    cards: [c(1, 0), c(1, 2), c(2, 1), c(2, 3), c(3, 0), c(3, 2)],
    beats: 'A single 2, or a lower run of 3 pairs. Can also be led like a normal play.',
  },
  {
    n: 4, name: 'Three 2s', vi: 'ba heo', kind: 'pig',
    cards: [c(12, 0), c(12, 2), c(12, 3)],
    beats: 'Any other triple. Only 5 consecutive pairs can chop it.',
  },
  {
    n: 5, name: 'Pair of 2s', vi: 'đôi heo', kind: 'pig',
    cards: [c(12, 1), c(12, 3)],
    beats: 'Any other pair. Chopped by four of a kind or 4 consecutive pairs.',
  },
  {
    n: 6, name: 'Single 2', vi: 'heo', kind: 'pig',
    cards: [c(12, 3)],
    beats: 'Any other single. Chopped by four of a kind or 3+ consecutive pairs.',
  },
  {
    n: 7, name: 'Triple', vi: 'sám cô', kind: '',
    cards: [c(10, 0), c(10, 2), c(10, 3)],
    beats: 'A lower triple.',
  },
  {
    n: 8, name: 'Straight', vi: 'sảnh', kind: '',
    cards: [c(4, 1), c(5, 2), c(6, 0), c(7, 3), c(8, 1)],
    beats: 'A lower straight of the same length. 3+ cards, no 2s.',
  },
  {
    n: 9, name: 'Pair', vi: 'đôi', kind: '',
    cards: [c(9, 1), c(9, 3)],
    beats: 'A lower pair. Ties go to the pair with the higher suit.',
  },
  {
    n: 10, name: 'Single', vi: 'rác', kind: '',
    cards: [c(11, 0)],
    beats: 'A lower single. Same rank? Higher suit wins.',
  },
];

let built = false;

function build() {
  const list = document.getElementById('guideList');
  list.innerHTML = '';
  for (const t of TIERS) {
    const li = document.createElement('li');
    li.className = `tier ${t.kind}`;
    li.dataset.tier = t.n;
    li.innerHTML = `
      <span class="tier-n">${t.n}</span>
      <div class="tier-body">
        <div class="tier-head">
          <b>${t.name}</b><span lang="vi">${t.vi}</span>
          <span class="tier-flags"><i class="flag table">On table</i><i class="flag held">In hand</i></span>
        </div>
        <div class="tier-cards"></div>
        <p>${t.beats}</p>
      </div>`;
    const row = li.querySelector('.tier-cards');
    for (const id of t.cards) row.append(cardEl(id));
    list.append(li);
  }
  built = true;
}

/** Refresh the live markers. `hand` = my cards, `target` = combo currently on the table. */
export function updateGuide(hand = [], target = null) {
  if (!built) build();
  const held = new Set(allPlays(hand).map((p) => tierOf(p.combo)));
  const onTable = tierOf(target);
  for (const li of document.querySelectorAll('#guideList .tier')) {
    const n = Number(li.dataset.tier);
    li.classList.toggle('held', held.has(n));
    li.classList.toggle('on-table', onTable === n);
  }
}

export function setGuide(open) {
  if (!built) build();
  const g = document.getElementById('guide');
  g.classList.toggle('open', open);
  g.setAttribute('aria-hidden', String(!open));
  document.getElementById('guideHandle').setAttribute('aria-expanded', String(open));
}
export const toggleGuide = () => setGuide(!document.getElementById('guide').classList.contains('open'));
export const guideOpen = () => document.getElementById('guide').classList.contains('open');
