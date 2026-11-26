import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, canBeat, findInstantWin, legalPlays, isChop, chopValue, rankOf } from '../shared/rules.js';
import { Game } from '../server/game.js';
import { chooseMove } from '../server/bot.js';

// helper: "3s" "10h" "2d" ...
const R = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const S = { s: 0, c: 1, d: 2, h: 3 };
const c = (str) => R.indexOf(str.slice(0, -1)) * 4 + S[str.at(-1)];
const cs = (str) => str.split(' ').map(c);
const A = (str) => analyze(cs(str));

test('combination detection', () => {
  assert.equal(A('3s').type, 'single');
  assert.equal(A('7s 7h').type, 'pair');
  assert.equal(A('7s 7h 7d').type, 'triple');
  assert.equal(A('9s 9h 9d 9c').type, 'quad');
  assert.equal(A('3s 4h 5d').type, 'straight');
  assert.equal(A('10s Jh Qd Kc As').type, 'straight');
  assert.equal(A('Qs Kh Ad 2c'), null, '2 cannot be in a straight');
  assert.equal(A('3s 4h'), null);
  assert.equal(A('3s 3h 4d 4c 5s 5h').type, 'pairseq');
  assert.equal(A('3s 3h 4d 4c 6s 6h'), null);
  assert.equal(A('Ks Kh As Ac 2s 2h'), null);
  assert.equal(A('3s 3h 5d'), null);
});

test('normal beats', () => {
  assert.ok(canBeat(A('3h'), A('3s')), 'suit breaks ties');
  assert.ok(!canBeat(A('3s'), A('3h')));
  assert.ok(canBeat(A('2s'), A('Ah')));
  assert.ok(canBeat(A('5s 5h'), A('5c 5d')));
  assert.ok(canBeat(A('4s 5s 6h'), A('4c 5d 6d')));
  assert.ok(!canBeat(A('4s 5s 6h 7h'), A('4c 5d 6d')), 'lengths must match');
  assert.ok(!canBeat(A('9s 9h'), A('9s')));
});

test('chops', () => {
  const quad = A('4s 4c 4d 4h');
  const p3 = A('5s 5h 6s 6h 7s 7h');
  const p4 = A('5s 5h 6s 6h 7s 7h 8s 8h');
  assert.ok(canBeat(quad, A('2h')));
  assert.ok(canBeat(p3, A('2h')));
  assert.ok(canBeat(quad, A('2h 2s')));
  assert.ok(!canBeat(p3, A('2h 2s')));
  assert.ok(canBeat(p4, A('2h 2s')));
  assert.ok(canBeat(quad, p3));
  assert.ok(canBeat(p4, quad));
  assert.ok(!canBeat(quad, A('Ah')), 'bombs only chop 2s');
  assert.ok(isChop(quad, A('2h')));
  assert.equal(chopValue(cs('2h'), A('2h')), 2);
  assert.equal(chopValue(cs('2s 2d'), A('2s 2d')), 3);
});

test('instant wins', () => {
  assert.equal(findInstantWin(cs('2s 2c 2d 2h 3s 4s 5s 6s 7s 8s 9s 10s Js')), 'Four 2s');
  assert.equal(findInstantWin(cs('3s 4s 5s 6s 7s 8s 9s 10s Js Qs Ks As 2h')), 'Dragon (3 through A)');
  assert.equal(findInstantWin(cs('3s 3h 5s 5h 7s 7h 9s 9h Js Jh Ks Kh 2h')), 'Six pairs');
  assert.equal(findInstantWin(cs('3s 4h 6s 8h 10s Qh Ks 2h 2s 9d 9h Jd Ac')), null);
});

test('legal plays respect target and required card', () => {
  const hand = cs('3s 4h 5d 5s 9c');
  const plays = legalPlays(hand, null, c('3s'));
  assert.ok(plays.length && plays.every((p) => p.cards.includes(c('3s'))));
  assert.ok(plays.some((p) => p.combo.type === 'straight'));
});

function playOut(seed, n = 4, settings = {}) {
  let s = seed;
  const rng = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = new Game(players, { tribute: false, ...settings }, { rng });
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 2000) {
    const id = g.turn;
    const move = chooseMove(g, id);
    const res = move ? g.play(id, move) : g.pass(id);
    assert.ok(res.ok, res.error);
  }
  return g;
}

test('bots can play full hands to completion, points sum to zero', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const n = 2 + (seed % 3);
    const g = playOut(seed, n);
    assert.equal(g.phase, 'over', `seed ${seed} did not finish`);
    assert.equal(new Set(g.result.placings).size, n);
    const sum = Object.values(g.result.delta).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, 'zero-sum scoring');
  }
});

test('first lead must include lowest card', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  const g = new Game(players, { instantWin: false });
  assert.equal(g.hands[g.turn][0], 0, '3♠ holder leads with 4 players');
  const other = g.hands[g.turn].find((x) => x !== 0);
  assert.equal(g.play(g.turn, [other]).ok, false);
});

test('tribute: loser pays highest 2, winner gives any card back, loser leads; no 2 = winner leads', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  let paid = 0, unpaid = 0;
  for (let seed = 1; seed <= 200; seed++) {
    let x = seed;
    const rng = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const g = new Game(players, { tribute: true, instantWin: false }, { handNo: 2, prevWinner: 'a', prevLoser: 'd', rng });
    const t = g.tribute;
    if (t.given != null) {
      paid++;
      assert.equal(g.phase, 'tribute', 'waits for the winner to give a card back');
      assert.equal(rankOf(t.given), 12, 'a 2 is paid');
      assert.ok(g.hands.d.every((c) => c < t.given || rankOf(c) !== 12), 'it was their highest 2');
      assert.equal(g.hands.a.length, 14);
      assert.equal(g.hands.d.length, 12);
      assert.equal(g.play('a', [g.hands.a[0]]).ok, false, 'no playing before the give-back');
      assert.equal(g.returnTribute('d', g.hands.d[0]).ok, false, 'only the winner gives back');
      const back = g.hands.a[5];
      assert.ok(g.returnTribute('a', back).ok);
      assert.equal(g.hands.a.length, 13);
      assert.equal(g.hands.d.length, 13);
      assert.ok(g.hands.d.includes(back) && !g.hands.a.includes(back));
      assert.equal(g.phase, 'playing');
      assert.equal(g.turn, 'd', 'loser leads after paying');
      assert.equal(g.view('b').tribute.returned, null, 'others do not see the returned card');
      assert.equal(g.view('d').tribute.returned, back);
    } else {
      unpaid++;
      assert.equal(g.phase, 'playing');
      assert.ok(g.hands.d.every((c) => rankOf(c) !== 12), 'loser really had no 2');
      assert.equal(g.hands.a.length, 13);
      assert.equal(g.hands.d.length, 13);
      assert.equal(g.turn, 'a', 'winner leads when no 2 was paid');
    }
  }
  assert.ok(paid > 0 && unpaid > 0, 'both branches exercised');
  const off = new Game(players, { tribute: false, instantWin: false }, { handNo: 2, prevWinner: 'a', prevLoser: 'd' });
  assert.equal(off.tribute, null);
  assert.equal(off.turn, 'a', 'tribute off: winner leads as before');
});

test('every hand is a fresh 52-card shuffle', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const g1 = new Game(players, { instantWin: false });
  const g2 = new Game(players, { instantWin: false }, { handNo: 2, prevWinner: 'a', prevLoser: 'b' });
  for (const g of [g1, g2]) {
    const all = [...g.hands.a, ...g.hands.b];
    assert.equal(new Set(all).size, all.length, 'no duplicates');
    assert.equal(all.length, 26);
  }
  assert.notEqual(g1.hands.a.join(), g2.hands.a.join());
});

test('last player at the table wins when everyone else leaves', async () => {
  const { Room } = await import('../server/room.js');
  const room = new Room('TEST', () => {});
  room.settings.instantWin = false;
  room.settings.tribute = false;
  room.settings.turnSeconds = 0;
  const a = room.join('ta', 'A').player;
  const b = room.join('tb', 'B').player;
  const c = room.join('tc', 'C').player;
  assert.equal(room.start(), null);
  room.removePlayer(b.id);
  assert.equal(room.game.phase, 'playing', 'two players still seated: keep playing');
  room.removePlayer(a.id);
  assert.equal(room.game.phase, 'over');
  assert.equal(room.game.result.placings[0], c.id);
  assert.equal(room.game.result.forfeit, c.id);
  assert.equal(room.lastWinner, c.id);
  assert.ok(room.scores[c.id] > 0);
  assert.equal(room.hostId, c.id, 'host passes to whoever stays');
  room.destroy();
});

test('bots keep the hand alive when humans leave', async () => {
  const { Room } = await import('../server/room.js');
  const room = new Room('TES2', () => {});
  room.settings.instantWin = false;
  room.settings.turnSeconds = 0;
  const a = room.join('ta', 'A').player;
  const b = room.join('tb', 'B').player;
  room.addBot();
  room.start();
  room.removePlayer(b.id);
  assert.notEqual(room.game.phase, 'over', 'A and the bot are still playing');
  room.destroy();
});
