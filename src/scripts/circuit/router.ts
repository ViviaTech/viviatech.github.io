/**
 * A small two-layer PCB autorouter.
 *
 * A* over an octilinear grid, where the search state is (cell, heading, layer).
 * Heading limits turns to 45° at a time, the way real traces are laid out. Layer
 * is what makes dense boards routable: on a single layer, one trace running edge
 * to edge splits the board in two, so a net can drop through a via and pass
 * underneath instead. Each routed net reserves its cells for the nets after it.
 *
 * Pure TypeScript with no DOM: the browser runs it for the live board, and Node
 * runs it at build time to generate the journal covers.
 */

export interface Point {
  x: number;
  y: number;
}

/** A routed cell. Layer 0 is the top copper, layer 1 the bottom. */
export interface NetCell extends Point {
  layer: number;
}

export interface Request {
  from: Point;
  to: Point;
}

export interface RouterOptions {
  cols: number;
  rows: number;
  /** Extra cost per 45° turn. Higher gives longer straight runs. */
  turnCost?: number;
  /** Cost multiplier beside an existing trace. Below 1 pulls nets into buses. */
  hug?: number;
  /** Cost of dropping through a via. High enough that vias stay the exception. */
  viaCost?: number;
  /** Cost multiplier on the bottom layer, so nets prefer the top. */
  bottomCost?: number;
  /** Heuristic weight. Above 1 trades shortest paths for speed. */
  greed?: number;
  /** Search limit per net, so one impossible net can't stall a frame. */
  maxExpansions?: number;
  /** Keep the cells each search explored, for the x-ray view. */
  recordVisits?: boolean;
}

export type Random = () => number;

const KEEPOUT = 4; // Grid bits 0 and 1 mark a trace on layer 0 and 1.

// Headings clockwise from east. Adding 1 or 7 (mod 8) is a 45° turn.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const STEP = DX.map((dx, i) => (dx !== 0 && DY[i] !== 0 ? Math.SQRT2 : 1));
const TURNS = [0, 1, 7];

const BACKSLASH = 1; // a diagonal from top-left to bottom-right of a grid square
const SLASH = 2; // a diagonal from top-right to bottom-left

const encode = (cell: number, heading: number, layer: number) => (cell << 4) | (heading << 1) | layer;

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size() {
    return this.keys.length;
  }

  clear() {
    this.keys.length = 0;
    this.values.length = 0;
  }

  push(key: number, value: number) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop() {
    const { keys, values } = this;
    const top = values[0];
    const key = keys.pop()!;
    const value = values.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}

export class Router {
  readonly cols: number;
  readonly rows: number;
  /** Bit flags per grid point: a trace on each layer, or a keep-out. */
  readonly grid: Uint8Array;
  /** Cells explored across all searches, when recordVisits is on. */
  readonly visits: number[] = [];
  expansions = 0;

  private readonly diagonals: Uint8Array;
  private readonly cost: Float32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly parent: Int32Array;
  private readonly heap = new MinHeap();
  private readonly turnCost: number;
  private readonly hug: number;
  private readonly viaCost: number;
  private readonly bottomCost: number;
  private readonly greed: number;
  private readonly maxExpansions: number;
  private readonly recordVisits: boolean;
  private search = 0;

  constructor(options: RouterOptions) {
    const { cols, rows } = options;
    this.cols = cols;
    this.rows = rows;
    this.turnCost = options.turnCost ?? 1.5;
    this.hug = options.hug ?? 0.82;
    this.viaCost = options.viaCost ?? 7;
    this.bottomCost = options.bottomCost ?? 1.1;
    this.greed = options.greed ?? 1.15;
    this.maxExpansions = options.maxExpansions ?? 40000;
    this.recordVisits = options.recordVisits ?? false;

    const cells = cols * rows;
    const states = cells * 16;
    this.grid = new Uint8Array(cells);
    this.diagonals = new Uint8Array(cells);
    this.cost = new Float32Array(states);
    this.seen = new Uint32Array(states);
    this.closed = new Uint32Array(states);
    this.parent = new Int32Array(states);
  }

  /** True if a net could still start or end here, on at least one layer. */
  isFree(p: Point) {
    if (!this.inBounds(p.x, p.y)) return false;
    const cell = p.y * this.cols + p.x;
    return this.layerFree(cell, 0) || this.layerFree(cell, 1);
  }

  /** Block every grid point in an inclusive cell range. */
  blockRect(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.max(0, y0); y <= Math.min(this.rows - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.cols - 1, x1); x++) {
        this.grid[y * this.cols + x] = KEEPOUT;
      }
    }
  }

  /** Block every grid point within a radius, in cells. */
  blockCircle(cx: number, cy: number, radius: number) {
    const r = Math.ceil(radius);
    for (let y = Math.floor(cy) - r; y <= Math.ceil(cy) + r; y++) {
      for (let x = Math.floor(cx) - r; x <= Math.ceil(cx) + r; x++) {
        if (this.inBounds(x, y) && Math.hypot(x - cx, y - cy) <= radius) {
          this.grid[y * this.cols + x] = KEEPOUT;
        }
      }
    }
  }

  /** Find a path, reserve it, and return its cells. Null if unroutable. */
  route(from: Point, to: Point): NetCell[] | null {
    if (!this.isFree(from) || !this.isFree(to)) return null;

    const { cols, rows, cost, seen, closed, parent, heap } = this;
    const start = from.y * cols + from.x;
    const goal = to.y * cols + to.x;
    if (start === goal) return null;

    const search = ++this.search;
    const estimate = (x: number, y: number) => {
      const dx = Math.abs(x - to.x);
      const dy = Math.abs(y - to.y);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * this.greed;
    };

    // Nets start on the top layer when they can. The bottom layer is for crossings.
    const startLayer = this.layerFree(start, 0) ? 0 : 1;
    heap.clear();
    for (let heading = 0; heading < 8; heading++) {
      const state = encode(start, heading, startLayer);
      cost[state] = 0;
      seen[state] = search;
      parent[state] = -1;
      heap.push(estimate(from.x, from.y), state);
    }

    const visit = (state: number, parentState: number, total: number, x: number, y: number) => {
      if (seen[state] === search && total >= cost[state]) return;
      seen[state] = search;
      cost[state] = total;
      parent[state] = parentState;
      heap.push(total + estimate(x, y), state);
    };

    let found = -1;
    let budget = this.maxExpansions;

    while (heap.size > 0 && budget-- > 0) {
      const state = heap.pop();
      if (closed[state] === search) continue;
      closed[state] = search;
      this.expansions++;

      const cell = state >> 4;
      if (cell === goal) {
        found = state;
        break;
      }

      const heading = (state >> 1) & 7;
      const layer = state & 1;
      const x = cell % cols;
      const y = (cell - x) / cols;
      if (this.recordVisits) this.visits.push(cell);

      for (const turn of TURNS) {
        const next = (heading + turn) & 7;
        const nx = x + DX[next];
        const ny = y + DY[next];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

        const nextCell = ny * cols + nx;
        if (!this.layerFree(nextCell, layer)) continue;
        // The board's outer ring is for entry points. A trace running along it
        // would use up the entry points of the nets after it.
        if ((nx === 0 || ny === 0 || nx === cols - 1 || ny === rows - 1) && nextCell !== goal) continue;
        if (STEP[next] !== 1 && this.diagonalBlocked(x, y, nx, ny, layer)) continue;

        let step = STEP[next] + (turn === 0 ? 0 : this.turnCost);
        if (this.besideTrace(nx, ny, layer)) step *= this.hug;
        if (layer === 1) step *= this.bottomCost;
        visit(encode(nextCell, next, layer), state, cost[state] + step, nx, ny);
      }

      // Drop through a via. The cell has to be clear on the other layer too.
      if (this.layerFree(cell, 1 - layer)) {
        visit(encode(cell, heading, 1 - layer), state, cost[state] + this.viaCost, x, y);
      }
    }

    if (found < 0) return null;

    const cells: NetCell[] = [];
    for (let state = found; state !== -1; state = parent[state]) {
      const cell = state >> 4;
      const x = cell % cols;
      cells.push({ x, y: (cell - x) / cols, layer: state & 1 });
    }
    cells.reverse();
    this.reserve(cells);
    return cells;
  }

  private inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  private layerFree(cell: number, layer: number) {
    return (this.grid[cell] & (KEEPOUT | (1 << layer))) === 0;
  }

  private besideTrace(x: number, y: number, layer: number) {
    const { grid, cols, rows } = this;
    const trace = 1 << layer;
    const i = y * cols + x;
    return (
      (x > 0 && (grid[i - 1] & trace) !== 0) ||
      (x < cols - 1 && (grid[i + 1] & trace) !== 0) ||
      (y > 0 && (grid[i - cols] & trace) !== 0) ||
      (y < rows - 1 && (grid[i + cols] & trace) !== 0)
    );
  }

  private diagonalBit(x0: number, y0: number, x1: number, y1: number, layer: number) {
    return ((x1 - x0) * (y1 - y0) > 0 ? BACKSLASH : SLASH) << (layer * 2);
  }

  private diagonalBlocked(x0: number, y0: number, x1: number, y1: number, layer: number) {
    const square = Math.min(y0, y1) * this.cols + Math.min(x0, x1);
    // The other diagonal of this square, on the same layer.
    return (this.diagonals[square] & this.diagonalBit(x1, y0, x0, y1, layer)) !== 0;
  }

  private reserve(cells: NetCell[]) {
    cells.forEach((cell, i) => {
      this.grid[cell.y * this.cols + cell.x] |= 1 << cell.layer;
      const prev = cells[i - 1];
      if (prev && prev.x !== cell.x && prev.y !== cell.y) {
        const square = Math.min(prev.y, cell.y) * this.cols + Math.min(prev.x, cell.x);
        this.diagonals[square] |= this.diagonalBit(prev.x, prev.y, cell.x, cell.y, cell.layer);
      }
    });
  }
}

/** Small seeded generator (mulberry32), so a seed always gives the same board. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for turning a post slug into a seed. */
export function hashSeed(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Plan nets that enter from the board edge and end at a nearby pad. Nets are
 * grouped into small parallel bundles, which is what makes a board read as a
 * board instead of random lines. Reach is limited because a net that spans the
 * whole board acts as a wall against everything routed after it.
 */
export function planNets(router: Router, random: Random, count: number): Request[] {
  const { cols, rows } = router;
  const shortest = Math.min(cols, rows) * 0.3;
  const longest = Math.max(cols, rows) * 0.55;
  const taken = new Set<number>();
  const key = (p: Point) => p.y * cols + p.x;
  const open = (p: Point) => router.isFree(p) && !taken.has(key(p));
  const requests: Request[] = [];

  for (let attempts = count * 30; requests.length < count && attempts > 0; attempts--) {
    const side = Math.floor(random() * 4);
    const along = side % 2 === 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const position = random();
    const anchor: Point =
      side === 0
        ? { x: 0, y: Math.floor(position * rows) }
        : side === 1
          ? { x: Math.floor(position * cols), y: 0 }
          : side === 2
            ? { x: cols - 1, y: Math.floor(position * rows) }
            : { x: Math.floor(position * cols), y: rows - 1 };

    const angle = random() * Math.PI * 2;
    const reach = shortest + random() * (longest - shortest);
    const end: Point = {
      x: Math.round(anchor.x + Math.cos(angle) * reach),
      y: Math.round(anchor.y + Math.sin(angle) * reach),
    };
    if (end.x < 2 || end.y < 2 || end.x > cols - 3 || end.y > rows - 3) continue;

    const size = Math.min(1 + Math.floor(random() * 4), count - requests.length);
    const bundle: Request[] = [];
    for (let i = 0; i < size; i++) {
      const from = { x: anchor.x + along.x * i, y: anchor.y + along.y * i };
      const to = { x: end.x + along.x * i, y: end.y + along.y * i };
      if (open(from) && open(to)) bundle.push({ from, to });
    }
    for (const { from, to } of bundle) {
      taken.add(key(from));
      taken.add(key(to));
    }
    requests.push(...bundle);
  }
  return requests;
}

/** Drop the cells in the middle of straight runs. Vias are kept. */
export function simplify(cells: NetCell[]): NetCell[] {
  return cells.filter((cell, i) => {
    const prev = cells[i - 1];
    const next = cells[i + 1];
    if (!prev || !next) return true;
    if (prev.layer !== cell.layer || next.layer !== cell.layer) return true;
    return cell.x - prev.x !== next.x - cell.x || cell.y - prev.y !== next.y - cell.y;
  });
}
