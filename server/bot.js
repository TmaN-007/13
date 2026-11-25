import { legalPlays, rankOf, TWO, isBomb, analyze } from '../shared/rules.js';

const usesTwos = (cards) => cards.some((c) => rankOf(c) === TWO);

/**
 * A simple but not-stupid bot: dumps low cards, keeps 2s and bombs for when they matter,
 * chops 2s when it can, and goes all-in when an opponent is about to go out.
 * Returns an array of cards to play, or null to pass.
 */
export function chooseMove(game, id) {
  const hand = game.hands[id];
  const target = game.target;
  const options = legalPlays(hand, target?.combo, game.mustInclude);
  if (!options.length) return null;

  // Whole hand in one go? Take it.
  if (analyze(hand) && options.some((o) => o.cards.length === hand.length)) return hand;

  const oppMin = Math.min(...game.active.filter((p) => p !== id).map((p) => game.hands[p].length));
  const danger = oppMin <= 2;
  const counts = Array(13).fill(0);
  for (const c of hand) counts[rankOf(c)]++;

  const cost = (o) => {
    let s = o.combo.top;                                  // lower is better
    if (usesTwos(o.cards)) s += danger ? 10 : 60;
    if (isBomb(o.combo)) s += target && rankOf(target.combo.top) === TWO ? -40 : 80;
    // penalise breaking up pairs / triples
    for (const c of o.cards) {
      const used = o.cards.filter((x) => rankOf(x) === rankOf(c)).length;
      if (used < counts[rankOf(c)] && o.combo.type !== 'single') s += 3;
      if (used < counts[rankOf(c)] && o.combo.type === 'single' && counts[rankOf(c)] >= 2) s += 6;
    }
    return s;
  };

  if (!target) {
    // Leading: get rid of the lowest card in the biggest sensible shape.
    const low = game.mustInclude ?? hand[0];
    const withLow = options.filter((o) => o.cards.includes(low) && !isBomb(o.combo) && !usesTwos(o.cards));
    const pool = withLow.length ? withLow : options;
    pool.sort((a, b) => b.cards.length - a.cards.length || cost(a) - cost(b));
    if (danger) {
      // Opponent close to out: lead something they likely can't follow (a multi-card shape).
      const multi = pool.find((o) => o.cards.length > 1);
      if (multi) return multi.cards;
    }
    return pool[0].cards;
  }

  options.sort((a, b) => cost(a) - cost(b));
  const best = options[0];
  // Don't throw 2s / bombs on cheap tricks early in the hand.
  if (!danger && (usesTwos(best.cards) || isBomb(best.combo)) && rankOf(target.combo.top) < 9 && hand.length > 5) {
    return null;
  }
  return best.cards;
}
