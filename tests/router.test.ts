import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRandom, hashSeed, planNets, Router, simplify, type NetCell, type Point } from '../src/scripts/circuit/router.ts';

const heading = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

/** Route a seeded board and return every net that succeeded. */
function board(seed: number, cols = 60, rows = 34, count = 36) {
  const router = new Router({ cols, rows });
  router.blockRect(8, 8, 30, 22);
  router.blockCircle(46, 17, 7);
  const nets = planNets(router, createRandom(seed), count)
    .map(({ from, to }) => router.route(from, to))
    .filter((net): net is NetCell[] => net !== null);
  return { router, nets };
}

test('finds a path across an empty board', () => {
  const router = new Router({ cols: 20, rows: 10 });
  const net = router.route({ x: 0, y: 0 }, { x: 19, y: 9 });
  assert.ok(net);
  assert.deepEqual(net[0], { x: 0, y: 0, layer: 0 });
  assert.deepEqual(net.at(-1), { x: 19, y: 9, layer: 0 });
});

test('moves one grid step at a time and only turns 45° at once', () => {
  for (const cells of board(1).nets) {
    // A via stays in place, so compare the path with those repeats removed.
    const net = cells.filter((c, i) => i === 0 || c.x !== cells[i - 1].x || c.y !== cells[i - 1].y);
    for (let i = 1; i < net.length; i++) {
      const dx = Math.abs(net[i].x - net[i - 1].x);
      const dy = Math.abs(net[i].y - net[i - 1].y);
      assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, 'step is one cell in one of 8 directions');
      if (i < 2) continue;
      let turn = Math.abs(heading(net[i - 1], net[i]) - heading(net[i - 2], net[i - 1]));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      assert.ok(turn <= Math.PI / 4 + 1e-9, `turned ${(turn * 180) / Math.PI}°`);
    }
  }
});

test('never enters a keep-out', () => {
  for (const net of board(2).nets) {
    for (const { x, y } of net) {
      assert.ok(!(x >= 8 && x <= 30 && y >= 8 && y <= 22), `rect intrusion at ${x},${y}`);
      assert.ok(Math.hypot(x - 46, y - 17) > 7, `circle intrusion at ${x},${y}`);
    }
  }
});

test('nets never share a cell on the same layer', () => {
  const seen = new Set<string>();
  for (const net of board(3).nets) {
    for (const { x, y, layer } of net) {
      const key = `${x},${y},${layer}`;
      const repeatInNet = net.filter((c) => c.x === x && c.y === y && c.layer === layer).length > 1;
      assert.ok(!repeatInNet, `net visits ${key} twice`);
      assert.ok(!seen.has(key), `cell ${key} used twice`);
    }
    for (const { x, y, layer } of net) seen.add(`${x},${y},${layer}`);
  }
});

test('a via only happens where both layers are clear', () => {
  const owners = new Map<string, number>();
  const { nets } = board(6);
  nets.forEach((net, id) => net.forEach(({ x, y, layer }) => owners.set(`${x},${y},${layer}`, id)));
  nets.forEach((net, id) => {
    net.forEach((cell, i) => {
      const prev = net[i - 1];
      if (!prev || prev.layer === cell.layer) return;
      assert.ok(prev.x === cell.x && prev.y === cell.y, 'a layer change stays in the same cell');
      assert.equal(owners.get(`${cell.x},${cell.y},0`), id);
      assert.equal(owners.get(`${cell.x},${cell.y},1`), id);
    });
  });
});

test('passes under a trace that would otherwise wall off the goal', () => {
  const router = new Router({ cols: 21, rows: 11 });
  // A trace from the top edge to the bottom edge splits the top layer in two.
  assert.ok(router.route({ x: 10, y: 0 }, { x: 10, y: 10 }));
  const net = router.route({ x: 0, y: 5 }, { x: 20, y: 5 });
  assert.ok(net, 'routed across the wall');
  assert.ok(net.some((cell) => cell.layer === 1), 'used the bottom layer');
});

test('diagonals never cross on the same layer', () => {
  const squares = new Map<string, 'backslash' | 'slash'>();
  for (const net of board(4).nets) {
    for (let i = 1; i < net.length; i++) {
      const [a, b] = [net[i - 1], net[i]];
      if (a.x === b.x || a.y === b.y) continue;
      const key = `${Math.min(a.x, b.x)},${Math.min(a.y, b.y)},${b.layer}`;
      const kind = (b.x - a.x) * (b.y - a.y) > 0 ? 'backslash' : 'slash';
      const other = squares.get(key);
      assert.ok(other === undefined || other === kind, `diagonals cross in square ${key}`);
      squares.set(key, kind);
    }
  }
});

test('a walled-off goal returns null and reserves nothing', () => {
  const router = new Router({ cols: 12, rows: 12 });
  router.blockRect(6, 0, 6, 11);
  assert.equal(router.route({ x: 0, y: 5 }, { x: 11, y: 5 }), null);
  assert.ok(router.isFree({ x: 0, y: 5 }));
});

test('refuses endpoints inside a keep-out', () => {
  const router = new Router({ cols: 12, rows: 12 });
  router.blockRect(5, 5, 7, 7);
  assert.equal(router.route({ x: 6, y: 6 }, { x: 0, y: 0 }), null);
});

test('the same seed gives the same board', () => {
  assert.deepEqual(board(7).nets, board(7).nets);
  assert.notDeepEqual(board(7).nets, board(8).nets);
});

test('routes most of a dense board', () => {
  const { nets } = board(5);
  assert.ok(nets.length >= 33, `only ${nets.length}/36 routed`);
});

test('simplify keeps endpoints and corners only', () => {
  const cells = [
    { x: 0, y: 0, layer: 0 },
    { x: 1, y: 0, layer: 0 },
    { x: 2, y: 0, layer: 0 },
    { x: 3, y: 1, layer: 0 },
    { x: 4, y: 2, layer: 0 },
    { x: 5, y: 2, layer: 0 },
  ];
  assert.deepEqual(simplify(cells), [cells[0], cells[2], cells[4], cells[5]]);
});

test('simplify keeps both sides of a via', () => {
  const cells = [
    { x: 0, y: 0, layer: 0 },
    { x: 1, y: 0, layer: 0 },
    { x: 1, y: 0, layer: 1 },
    { x: 2, y: 0, layer: 1 },
  ];
  assert.deepEqual(simplify(cells), cells);
});

test('hashSeed is stable and spreads similar slugs', () => {
  assert.equal(hashSeed('quietly-powerful'), hashSeed('quietly-powerful'));
  assert.notEqual(hashSeed('tools-we-take'), hashSeed('tools-we-tale'));
});
