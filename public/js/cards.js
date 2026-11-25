import { RANKS, rankOf, suitOf, isRed } from '/shared/rules.js';

const L = 18, C = 50, Rt = 82; // pip columns (% of the face area)
// Pip layouts: [x%, y%] — pips below the middle are drawn upside-down like a real deck.
const PIPS = {
  '2': [[C, 8], [C, 92]],
  '3': [[C, 8], [C, 50], [C, 92]],
  '4': [[L, 8], [Rt, 8], [L, 92], [Rt, 92]],
  '5': [[L, 8], [Rt, 8], [C, 50], [L, 92], [Rt, 92]],
  '6': [[L, 8], [Rt, 8], [L, 50], [Rt, 50], [L, 92], [Rt, 92]],
  '7': [[L, 8], [Rt, 8], [C, 29], [L, 50], [Rt, 50], [L, 92], [Rt, 92]],
  '8': [[L, 8], [Rt, 8], [C, 29], [L, 50], [Rt, 50], [C, 71], [L, 92], [Rt, 92]],
  '9': [[L, 8], [Rt, 8], [L, 36], [Rt, 36], [C, 50], [L, 64], [Rt, 64], [L, 92], [Rt, 92]],
  '10': [[L, 8], [Rt, 8], [C, 22], [L, 36], [Rt, 36], [L, 64], [Rt, 64], [C, 78], [L, 92], [Rt, 92]],
};

const suitSvg = (s, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24"><use href="#suit-${s}"/></svg>`;

export function cardHTML(id) {
  const r = RANKS[rankOf(id)];
  const s = suitOf(id);
  const idx = `<span class="r${r === '10' ? ' ten' : ''}">${r}</span>${suitSvg(s)}`;
  let face;
  if (PIPS[r]) {
    face = `<div class="face">${PIPS[r]
      .map(([x, y]) => `<svg class="pip${y > 55 ? ' flip' : ''}" style="left:${x}%;top:${y}%" viewBox="0 0 24 24"><use href="#suit-${s}"/></svg>`)
      .join('')}</div>`;
  } else if (r === 'A') {
    face = `<div class="face">${suitSvg(s, 'ace')}</div>`;
  } else {
    face = `<div class="court"><span class="big">${r}</span>${suitSvg(s, 'top')}${suitSvg(s)}</div>`;
  }
  return `<div class="idx tl">${idx}</div>${face}<div class="idx br">${idx}</div>`;
}

export function cardEl(id) {
  const el = document.createElement('div');
  el.className = `card s${suitOf(id)} r${rankOf(id)}${isRed(id) ? ' red' : ''}`;
  el.dataset.id = id;
  el.innerHTML = cardHTML(id);
  el.setAttribute('aria-label', `${RANKS[rankOf(id)]} of ${['spades', 'clubs', 'diamonds', 'hearts'][suitOf(id)]}`);
  return el;
}

export function backEl() {
  const el = document.createElement('div');
  el.className = 'card back';
  return el;
}

/** Inline, text-sized card label with a vector suit, e.g. "10♥". */
export function cardTag(id) {
  const red = isRed(id);
  return `<span class="ctag" style="white-space:nowrap;font-weight:800;color:${red ? '#ff8a7a' : 'inherit'}">${RANKS[rankOf(id)]}<svg style="width:.8em;height:.8em;fill:currentColor;vertical-align:-.05em;margin-left:1px" viewBox="0 0 24 24"><use href="#suit-${suitOf(id)}"/></svg></span>`;
}
