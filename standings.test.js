'use strict';
/* Unit tests for the league table tie-breakers (no server needed). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tally, rank } = require('../server/services/standings');

const m = (h, a, hs, as) => ({ home_club_id: h, away_club_id: a, home_score: hs, away_score: as });
function order(matches, { fair = {}, manual = {} } = {}) {
  const ids = [1, 2, 3, 4];
  const overall = tally(ids, matches);
  return rank(ids, matches, overall, new Map(Object.entries(fair).map(([k, v]) => [Number(k), v])), new Map(Object.entries(manual).map(([k, v]) => [Number(k), v])));
}

test('points decide first: win 3, draw 1, loss 0', () => {
  const t = tally([1, 2], [m(1, 2, 2, 0), m(2, 1, 1, 1)]);
  assert.deepEqual([t.get(1).pts, t.get(1).w, t.get(1).d, t.get(1).gf, t.get(1).ga, t.get(1).gd], [4, 1, 1, 3, 1, 2]);
  assert.deepEqual([t.get(2).pts, t.get(2).l], [1, 1]);
});

test('two clubs level on points are separated by their head-to-head result before goal difference', () => {
  // 1 and 2 both finish on 6 points; 2 has the better goal difference but 1 beat 2
  const r = order([m(1, 2, 1, 0), m(1, 3, 0, 1), m(1, 4, 1, 0), m(2, 3, 5, 0), m(2, 4, 5, 0), m(3, 4, 0, 0)]);
  assert.deepEqual(r.order.slice(0, 2), [1, 2]);
});

test('three-way tie: mini-table among the tied clubs, then re-applied to the remaining pair', () => {
  // 1, 2, 3 all on 6 points. Mini-table: 1 beat 2 3-0, 2 beat 3 1-0, 3 beat 1 1-0.
  // h2h points all 3; h2h GD: 1 = +2, 2 = -2, 3 = 0 -> 1, 3, 2
  const r = order([m(1, 2, 3, 0), m(2, 3, 1, 0), m(3, 1, 1, 0), m(1, 4, 1, 0), m(2, 4, 1, 0), m(3, 4, 1, 0)]);
  assert.deepEqual(r.order, [1, 3, 2, 4]);
  assert.equal(r.unresolved.size, 0);
});

test('mini-table recalculated for the subset still tied after the first head-to-head pass', () => {
  // 1, 2, 3 on 4 points; 1 beat 2 and drew 3 -> separated out on top of the mini-table? No: build so 3 is separated, 1 & 2 remain level
  // Mini-table: 1-2 1-1, 1-3 2-0, 2-3 2-0 -> 1: 4pts GD+2, 2: 4pts GD+2, 3: 0 pts -> 3 drops; 1 v 2 head-to-head is a draw -> overall GD decides
  const r = order([m(1, 2, 1, 1), m(1, 3, 2, 0), m(2, 3, 2, 0), m(1, 4, 0, 1), m(2, 4, 0, 3), m(3, 4, 9, 0)]);
  // points: 1 = 4, 2 = 4, 3 = 3, 4 = 6 -> 4 first; 1 & 2 level -> h2h draw -> overall GD: 1 = +1, 2 = -1
  assert.deepEqual(r.order, [4, 1, 2, 3]);
});

test('goals scored, then fair play, then administrator decision', () => {
  // 1 and 2 identical except goals scored
  const base = [m(1, 2, 2, 2), m(1, 3, 3, 1), m(2, 3, 2, 0), m(1, 4, 0, 1), m(2, 4, 0, 1), m(3, 4, 0, 0)];
  assert.deepEqual(order(base).order.slice(1, 3), [1, 2]);
  // identical record -> fair play decides (fewer points better)
  const same = [m(1, 2, 1, 1), m(1, 3, 2, 0), m(2, 3, 2, 0), m(1, 4, 0, 1), m(2, 4, 0, 1), m(3, 4, 0, 0)];
  assert.deepEqual(order(same, { fair: { 1: 3, 2: 1 } }).order.slice(1, 3), [2, 1]);
  // completely level -> flagged for the administrator, who then decides
  const r = order(same);
  assert.ok(r.unresolved.has(1) && r.unresolved.has(2));
  assert.deepEqual(order(same, { manual: { 1: 2, 2: 1 } }).order.slice(1, 3), [2, 1]);
});
