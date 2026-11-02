/**
 * Draws a routed board on a canvas and sends signals along it.
 *
 * Traces are drawn once into offscreen layers. Each frame only copies that layer
 * and draws the moving pulses, so the cost stays flat however many traces exist.
 */

import { createRandom, planNets, Router, simplify, type NetCell, type Point, type Request } from './router';

export type Mode = 'hero' | 'calm' | 'mini' | 'broken';

interface Trace {
  points: Point[];
  /** Layer of the segment that starts at each point. */
  layers: number[];
  /** Distance along the trace at each point. */
  lengths: number[];
  length: number;
  /** 0 to 1 along the brand gradient. */
  tone: number;
  colour: string;
  /** Where signals stop. Shorter than length on a broken net. */
  stop: number;
  /** Signals on this trace feed the target. */
  feeds: boolean;
}

interface Pulse {
  trace: Trace;
  at: number;
  speed: number;
  wait: number;
  once: boolean;
}

interface Growth {
  trace: Trace;
  /** Seconds since this trace started. Negative while it waits its turn. */
  time: number;
  duration: number;
  /** Grow from the far end, so the board spreads away from the origin. */
  reverse: boolean;
}

interface TraceStyle {
  top: number;
  bottom: number;
  width: number;
}

interface Tuning {
  pitch: [number, number];
  density: number;
  /** Share of nets that carry a signal. */
  pulses: number;
  /** Signal speed in px/s. Small boards need slow signals: their nets are short. */
  speed: [number, number];
  /** Pause between signals on a net, in seconds. */
  rest: [number, number];
  tail: number;
  /** Size of a signal's glow. */
  glow: number;
  /** Seconds before the first trace, seconds across the wave, and growth in px/s. */
  intro: { delay: number; spread: number; speed: number };
}

interface Flash {
  x: number;
  y: number;
  sprite: number;
  life: number;
}

interface PlannedNet extends Request {
  tone?: number;
  stub?: Point;
}

const STOPS = [
  [0, 245, 235],
  [42, 140, 255],
  [138, 108, 240],
  [245, 110, 219],
];
const SPRITES = 12;
const SPRITE_SIZE = 64;
const REVEAL_RADIUS = 170;
const ROUTE_BUDGET_MS = 4;
const SLOW_FRAME_MS = 24;

const DIM: TraceStyle = { top: 0.34, bottom: 0.14, width: 1 };
const BRIGHT: TraceStyle = { top: 0.95, bottom: 0.7, width: 1.4 };

const TUNING: Record<Mode, Tuning> = {
  hero: {
    pitch: [20, 34],
    density: 95,
    pulses: 1,
    speed: [150, 340],
    rest: [0.4, 3],
    tail: 110,
    glow: 30,
    intro: { delay: 1.3, spread: 2.2, speed: 360 },
  },
  calm: {
    pitch: [22, 36],
    density: 150,
    pulses: 0.5,
    speed: [150, 340],
    rest: [0.4, 3],
    tail: 110,
    glow: 30,
    intro: { delay: 0.1, spread: 1.8, speed: 340 },
  },
  mini: {
    pitch: [14, 16],
    density: 70,
    pulses: 0.6,
    speed: [28, 56],
    rest: [1.5, 5],
    tail: 42,
    glow: 16,
    intro: { delay: 0.2, spread: 1.4, speed: 110 },
  },
  broken: {
    pitch: [22, 36],
    density: 120,
    pulses: 0.8,
    speed: [150, 340],
    rest: [0.4, 3],
    tail: 110,
    glow: 30,
    intro: { delay: 0.1, spread: 1.8, speed: 340 },
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function colourAt(t: number) {
  const position = clamp(t, 0, 1) * (STOPS.length - 1);
  const index = Math.min(Math.floor(position), STOPS.length - 2);
  const mix = position - index;
  return STOPS[index].map((from, i) => Math.round(from + (STOPS[index + 1][i] - from) * mix));
}

function makeLayer(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Soft glow dots, pre-rendered so drawing one each frame is a cheap image copy. */
function makeSprites() {
  return Array.from({ length: SPRITES }, (_, i) => {
    const sprite = makeLayer(SPRITE_SIZE, SPRITE_SIZE);
    const ctx = sprite.getContext('2d')!;
    const mid = SPRITE_SIZE / 2;
    const [r, g, b] = colourAt(i / (SPRITES - 1));
    const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.09, `rgba(${r},${g},${b},1)`);
    glow.addColorStop(0.3, `rgba(${r},${g},${b},.28)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return sprite;
  });
}

function makeRevealMask(size: number) {
  const mask = makeLayer(size, size);
  const ctx = mask.getContext('2d')!;
  const mid = size / 2;
  const fade = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.45, 'rgba(0,0,0,.55)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return mask;
}

export class Board {
  visible = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly zone: HTMLElement;
  private readonly mode: Mode;
  private readonly tuning: Tuning;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly still: boolean;
  private readonly sprites = makeSprites();
  private readonly target: HTMLElement | null;
  private readonly telemetry: HTMLElement | null;
  private readonly seed = Math.floor(Math.random() * 2 ** 32);

  private width = 0;
  private height = 0;
  private dpr = 1;
  private pitch = 24;
  private router!: Router;
  private dim!: HTMLCanvasElement;
  private bright!: HTMLCanvasElement;
  private dimCtx!: CanvasRenderingContext2D;
  private brightCtx!: CanvasRenderingContext2D;
  private xray: HTMLCanvasElement | null = null;
  private reveal!: HTMLCanvasElement;
  private revealMask!: HTMLCanvasElement;

  private queue: PlannedNet[] = [];
  private traces: Trace[] = [];
  private growing: Growth[] = [];
  private pulses: Pulse[] = [];
  private flashes: Flash[] = [];
  private animated = false;
  private routeMs = 0;
  /** Where the intro spreads from: the target, or the middle of the board. */
  private origin: Point = { x: 0, y: 0 };

  private last = 0;
  private frameMs = 16;
  private slowFrames = 0;
  private chargeGoal = 0;
  private charge = 0;
  private shownCharge = -1;
  private nextHud = 0;
  private pointer: Point | null = null;
  private pointerStrength = 0;
  private xrayOn = false;

  constructor(canvas: HTMLCanvasElement, still: boolean) {
    this.canvas = canvas;
    this.still = still;
    this.zone = canvas.parentElement as HTMLElement;
    this.mode = (canvas.dataset.circuit as Mode) || 'calm';
    this.tuning = TUNING[this.mode];
    this.ctx = canvas.getContext('2d')!;
    this.target = this.zone.querySelector('[data-circuit-target]');
    this.telemetry = this.zone.querySelector('[data-telemetry]');

    this.telemetry?.addEventListener('click', () => this.toggleXray());
    if (!still) {
      this.zone.addEventListener('pointermove', this.onPointerMove, { passive: true });
      this.zone.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
      this.zone.addEventListener('click', this.onClick);
    }
  }

  /** Measure the page and plan the board. `animate` plays the routing intro. */
  build(animate: boolean) {
    const box = this.zone.getBoundingClientRect();
    this.width = Math.round(box.width);
    this.height = Math.round(box.height);

    // Cap the backing store: a 4K screen at 2x would be 33 million pixels.
    const pixels = this.width * this.height;
    this.dpr = clamp(Math.min(window.devicePixelRatio || 1, 2), 1, Math.max(1, Math.sqrt(6e6 / pixels)));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);

    const makeTraceLayer = () => {
      const layer = makeLayer(this.canvas.width, this.canvas.height);
      const ctx = layer.getContext('2d')!;
      ctx.scale(this.dpr, this.dpr);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      return [layer, ctx] as const;
    };
    [this.dim, this.dimCtx] = makeTraceLayer();
    [this.bright, this.brightCtx] = makeTraceLayer();
    this.xray = null;

    const revealSize = Math.round(REVEAL_RADIUS * 2 * this.dpr);
    this.reveal = makeLayer(revealSize, revealSize);
    this.revealMask = makeRevealMask(revealSize);

    const [minPitch, maxPitch] = this.tuning.pitch;
    this.pitch = Math.round(clamp(this.width / 60, minPitch, maxPitch));
    const cols = Math.ceil(this.width / this.pitch) + 1;
    const rows = Math.ceil(this.height / this.pitch) + 1;
    this.router = new Router({ cols, rows, recordVisits: true });

    this.traces = [];
    this.growing = [];
    this.pulses = [];
    this.flashes = [];
    this.routeMs = 0;
    this.animated = animate && !this.still;
    this.origin = { x: this.width / 2, y: this.height / 2 };

    this.blockKeepouts(box);
    const random = createRandom(this.seed);
    const targetNets = this.planTarget(box, random);
    const budget = Math.round((cols * rows) / this.tuning.density);
    this.queue = [
      ...targetNets,
      ...planNets(this.router, random, Math.max(0, budget - targetNets.length) + 6).slice(0, budget),
    ];

    if (this.still) {
      this.routeNext(Infinity);
      this.draw(0);
    }
    this.renderHud(true);
  }

  /** Advance one animation frame. */
  frame(now: number) {
    const dt = Math.min(now - (this.last || now), 50);
    this.last = now;
    if (dt > 0) this.frameMs += (dt - this.frameMs) * 0.08;

    if (this.queue.length > 0) {
      this.routeNext(ROUTE_BUDGET_MS);
      if (this.queue.length === 0 && this.animated) this.scheduleIntro();
    }
    this.update(dt / 1000);
    this.draw(dt / 1000);
    this.adapt();
    if (now > this.nextHud) {
      this.nextHud = now + 500;
      this.renderHud();
    }
  }

  private blockKeepouts(box: DOMRect) {
    const { pitch, router } = this;
    const margin = pitch * 0.75;
    this.zone.querySelectorAll('[data-keepout]').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      router.blockRect(
        Math.floor((rect.left - box.left - margin) / pitch),
        Math.floor((rect.top - box.top - margin) / pitch),
        Math.ceil((rect.right - box.left + margin) / pitch),
        Math.ceil((rect.bottom - box.top + margin) / pitch),
      );
    });
  }

  /**
   * Nets that feed the target. The target's data-gaps angles are the bays nets
   * enter through: on the logo, the five gaps in the outer ring.
   */
  private planTarget(box: DOMRect, random: () => number): PlannedNet[] {
    if (!this.target) return [];
    const { pitch, router } = this;
    const rect = this.target.getBoundingClientRect();
    if (rect.width === 0) return [];

    const cx = rect.left - box.left + rect.width / 2;
    const cy = rect.top - box.top + rect.height / 2;
    const radius = rect.width / 2;
    this.origin = { x: cx, y: cy };
    router.blockCircle(cx / pitch, cy / pitch, (radius + pitch * 0.5) / pitch);

    const gaps = (this.target.dataset.gaps ?? '0,90,180,270').split(',').map(Number);
    const reach = Number(this.target.dataset.reach ?? 0.84);
    const bayWidth = Number(this.target.dataset.bay ?? 0.26) * radius;
    const lanes = Math.max(0, Math.min(1, Math.floor(bayWidth / pitch / 2)));
    const nets: PlannedNet[] = [];

    for (const gap of gaps) {
      const angle = (gap * Math.PI) / 180;
      const out = { x: Math.cos(angle), y: Math.sin(angle) };
      const side = { x: -out.y, y: out.x };

      for (let lane = -lanes; lane <= lanes; lane++) {
        const pin = {
          x: cx + out.x * (radius + pitch * 1.4) + side.x * lane * pitch,
          y: cy + out.y * (radius + pitch * 1.4) + side.y * lane * pitch,
        };
        const to = { x: Math.round(pin.x / pitch), y: Math.round(pin.y / pitch) };
        if (!router.isFree(to)) continue;

        // Enter from whichever board edge this bay is facing.
        const heading = angle + (random() - 0.5) * 0.7;
        const ray = this.rayToEdge(pin, heading);
        const from = {
          x: clamp(Math.round(ray.x / pitch), 0, router.cols - 1),
          y: clamp(Math.round(ray.y / pitch), 0, router.rows - 1),
        };

        nets.push({
          from: this.nearestFreeEdge(from),
          to,
          tone: (pin.y - (cy - radius)) / (radius * 2),
          stub: {
            x: cx + out.x * radius * reach + side.x * lane * pitch,
            y: cy + out.y * radius * reach + side.y * lane * pitch,
          },
        });
      }
    }
    return nets;
  }

  private rayToEdge(from: Point, angle: number) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const toX = dx > 0 ? (this.width - from.x) / dx : dx < 0 ? -from.x / dx : Infinity;
    const toY = dy > 0 ? (this.height - from.y) / dy : dy < 0 ? -from.y / dy : Infinity;
    const distance = Math.min(toX, toY);
    return { x: from.x + dx * distance, y: from.y + dy * distance };
  }

  private nearestFreeEdge(from: Point): Point {
    const { router } = this;
    const horizontal = from.y === 0 || from.y === router.rows - 1;
    for (let step = 0; step < Math.max(router.cols, router.rows); step++) {
      for (const offset of step === 0 ? [0] : [step, -step]) {
        const p = horizontal ? { x: from.x + offset, y: from.y } : { x: from.x, y: from.y + offset };
        if (router.isFree(p)) return p;
      }
    }
    return from;
  }

  /** Route queued nets until the time budget runs out. */
  private routeNext(budgetMs: number) {
    const started = performance.now();
    while (this.queue.length > 0 && performance.now() - started < budgetMs) {
      const net = this.queue.shift()!;
      const before = performance.now();
      const cells = this.router.route(net.from, net.to);
      this.routeMs += performance.now() - before;
      if (cells) {
        const trace = this.makeTrace(cells, net);
        this.traces.push(trace);
        if (!this.animated) this.commit(trace);
      }
    }
  }

  /**
   * The board grows outward from the origin in one slow wave. Each trace starts
   * at its end nearest the origin, in order of distance, which gives the eye one
   * movement to follow instead of dozens starting at once.
   */
  private scheduleIntro() {
    const { origin } = this;
    const { delay, spread, speed } = this.tuning.intro;
    const distance = (p: Point) => Math.hypot(p.x - origin.x, p.y - origin.y);

    const starts = this.traces.map((trace) => {
      const first = distance(trace.points[0]);
      const last = distance(trace.points[trace.points.length - 1]);
      return { trace, reverse: last < first, near: Math.min(first, last) };
    });
    const farthest = Math.max(1, ...starts.map(({ near }) => near));

    this.growing = starts.map(({ trace, reverse, near }) => ({
      trace,
      reverse,
      time: -(delay + (near / farthest) * spread + Math.random() * 0.25),
      duration: clamp(trace.length / speed, 0.9, 2.6),
    }));
  }

  private makeTrace(cells: NetCell[], net: PlannedNet): Trace {
    const { pitch } = this;
    const corners = simplify(cells);
    const points: Point[] = corners.map((c) => ({ x: c.x * pitch, y: c.y * pitch }));
    const layers = corners.map((c) => c.layer);
    if (net.stub) {
      points.push(net.stub);
      layers.push(layers[layers.length - 1]);
    }

    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }

    const length = lengths[lengths.length - 1];
    const midpoint = points[Math.floor(points.length / 2)];
    const tone = clamp(net.tone ?? midpoint.y / this.height, 0, 1);
    const [r, g, b] = colourAt(tone);
    // Broken boards: signals die part way along, which is the point of a 404.
    const stop = this.mode === 'broken' ? length * (0.45 + Math.random() * 0.3) : length;
    return { points, layers, lengths, length, tone, colour: `rgb(${r},${g},${b})`, stop, feeds: !!net.stub };
  }

  /** Bake a finished trace into the static layers and give it signals. */
  private commit(trace: Trace) {
    this.paint(this.dimCtx, trace, DIM);
    this.paint(this.brightCtx, trace, BRIGHT);
    if (this.still || Math.random() > this.tuning.pulses) return;

    const { speed, rest } = this.tuning;
    this.pulses.push({
      trace,
      at: 0,
      speed: speed[0] + Math.random() * (speed[1] - speed[0]),
      // The first signals arrive gradually, after the board has settled.
      wait: 0.8 + Math.random() * rest[1] * 1.5,
      once: false,
    });
  }

  /**
   * Draw a trace, or the stretch of it between two distances. The growing intro
   * uses this too, so a trace looks identical before and after it's baked and
   * nothing visibly changes the moment it finishes.
   */
  private paint(
    ctx: CanvasRenderingContext2D,
    trace: Trace,
    { top, bottom, width }: TraceStyle,
    from = 0,
    to = trace.length,
  ) {
    const { points, layers, lengths, colour } = trace;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = width;

    for (let i = 0; i < points.length - 1; i++) {
      const start = Math.max(from, lengths[i]);
      const end = Math.min(to, lengths[i + 1]);
      if (end <= start) continue;

      const span = lengths[i + 1] - lengths[i];
      const a = (start - lengths[i]) / span;
      const b = (end - lengths[i]) / span;
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;

      ctx.globalAlpha = layers[i] === 0 ? top : bottom;
      ctx.setLineDash(layers[i] === 0 ? [] : [3, 5]);
      ctx.lineDashOffset = start - lengths[i];
      ctx.beginPath();
      ctx.moveTo(points[i].x + dx * a, points[i].y + dy * a);
      ctx.lineTo(points[i].x + dx * b, points[i].y + dy * b);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Vias: a ring where a net changes layer.
    ctx.globalAlpha = top;
    for (let i = 1; i < points.length; i++) {
      if (layers[i] !== layers[i - 1] && lengths[i] >= from && lengths[i] <= to) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // A pad where the net ends, unless it runs into the target.
    if (!trace.feeds && to >= trace.length) {
      const end = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(end.x, end.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private update(dt: number) {
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const growth = this.growing[i];
      growth.time += dt;
      if (growth.time >= growth.duration) {
        this.commit(growth.trace);
        this.growing.splice(i, 1);
      }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i];
      if (pulse.wait > 0) {
        pulse.wait -= dt;
        continue;
      }
      pulse.at += pulse.speed * dt;
      const { tail, rest } = this.tuning;
      if (pulse.at < pulse.trace.stop + (pulse.trace.stop < pulse.trace.length ? 0 : tail)) continue;

      this.arrive(pulse);
      if (pulse.once) {
        this.pulses.splice(i, 1);
      } else {
        pulse.at = 0;
        pulse.wait = rest[0] + Math.random() * (rest[1] - rest[0]);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt * 2.4;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }

    if (this.pointerStrength !== (this.pointer ? 1 : 0)) {
      const goal = this.pointer ? 1 : 0;
      this.pointerStrength = clamp(this.pointerStrength + Math.sign(goal - this.pointerStrength) * dt * 5, 0, 1);
    }

    if (this.target) {
      // Signals raise a goal and the glow eases towards it, so it swells and
      // settles instead of blinking with every arrival.
      this.chargeGoal *= Math.exp(-dt * 0.8);
      this.charge += (this.chargeGoal - this.charge) * (1 - Math.exp(-dt * 2.2));
      if (Math.abs(this.charge - this.shownCharge) > 0.004) {
        this.shownCharge = this.charge;
        this.target.style.setProperty('--charge', this.charge.toFixed(3));
      }
    }
  }

  private arrive(pulse: Pulse) {
    const { trace } = pulse;
    const end = this.pointAlong(trace, trace.stop);
    this.flashes.push({
      x: end.x,
      y: end.y,
      sprite: this.mode === 'broken' ? SPRITES - 1 : Math.round(trace.tone * (SPRITES - 1)),
      life: 1,
    });
    if (trace.feeds) this.chargeGoal = Math.min(1, this.chargeGoal + 0.1);
  }

  private pointAlong(trace: Trace, at: number): Point {
    const { points, lengths } = trace;
    const distance = clamp(at, 0, trace.length);
    let i = 1;
    while (i < points.length - 1 && lengths[i] < distance) i++;
    const span = lengths[i] - lengths[i - 1] || 1;
    const t = (distance - lengths[i - 1]) / span;
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
    };
  }

  /** Stroke the part of a trace between two distances. */
  private strokeSpan(trace: Trace, from: number, to: number) {
    const { ctx } = this;
    const { points, lengths } = trace;
    const start = this.pointAlong(trace, from);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < points.length; i++) {
      if (lengths[i] <= from) continue;
      if (lengths[i] >= to) break;
      ctx.lineTo(points[i].x, points[i].y);
    }
    const end = this.pointAlong(trace, to);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private draw(dt: number) {
    const { ctx, width, height, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.dim, 0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.xrayOn && this.xray) ctx.drawImage(this.xray, 0, 0, width, height);
    if (!this.still && dt > 0) this.drawSignals();
  }

  /** Where a growing trace has reached. Eased, so it starts and stops softly. */
  private growthSpan({ trace, time, duration, reverse }: Growth) {
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * (time / duration));
    const reach = trace.length * eased;
    return reverse
      ? { from: trace.length - reach, to: trace.length, head: trace.length - reach }
      : { from: 0, to: reach, head: reach };
  }

  private drawSignals() {
    const { ctx, tuning } = this;

    for (const growth of this.growing) {
      if (growth.time <= 0) continue;
      const { from, to } = this.growthSpan(growth);
      this.paint(ctx, growth.trace, DIM, from, to);
    }

    if (this.pointer && this.pointerStrength > 0) this.drawReveal();

    ctx.globalCompositeOperation = 'lighter';

    // A soft point of light leads each growing trace, fading in and out with it.
    for (const growth of this.growing) {
      if (growth.time <= 0) continue;
      const { trace, reverse } = growth;
      const { head } = this.growthSpan(growth);
      const progress = growth.time / growth.duration;
      const presence = Math.min(1, progress * 6, (1 - progress) * 6);
      const lead = tuning.tail * 0.7;

      ctx.strokeStyle = trace.colour;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.32 * presence;
      this.strokeSpan(
        trace,
        reverse ? head : Math.max(0, head - lead),
        reverse ? Math.min(trace.length, head + lead) : head,
      );
      const p = this.pointAlong(trace, head);
      this.drawSprite(Math.round(trace.tone * (SPRITES - 1)), p.x, p.y, tuning.glow * 0.6, 0.6 * presence);
    }

    const { tail, glow } = tuning;
    for (const pulse of this.pulses) {
      if (pulse.wait > 0) continue;
      const { trace, at } = pulse;
      const head = Math.min(at, trace.stop);
      ctx.strokeStyle = trace.colour;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.16;
      this.strokeSpan(trace, Math.max(0, at - tail), head);
      ctx.globalAlpha = 0.34;
      this.strokeSpan(trace, Math.max(0, at - tail * 0.6), head);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.75;
      this.strokeSpan(trace, Math.max(0, at - tail * 0.25), head);
      if (at <= trace.stop) {
        const p = this.pointAlong(trace, at);
        this.drawSprite(Math.round(trace.tone * (SPRITES - 1)), p.x, p.y, glow, 1);
      }
    }

    for (const flash of this.flashes) {
      this.drawSprite(flash.sprite, flash.x, flash.y, glow * (0.87 + (1 - flash.life) * 1.13), flash.life);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSprite(index: number, x: number, y: number, size: number, alpha: number) {
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.sprites[index], x - size / 2, y - size / 2, size, size);
  }

  /** The cursor reveals a brighter copy of the circuit around it. */
  private drawReveal() {
    const { ctx, dpr, pointer } = this;
    const reveal = this.reveal.getContext('2d')!;
    const size = this.reveal.width;
    const x = pointer!.x - REVEAL_RADIUS;
    const y = pointer!.y - REVEAL_RADIUS;

    reveal.globalCompositeOperation = 'copy';
    reveal.drawImage(this.bright, x * dpr, y * dpr, size, size, 0, 0, size, size);
    reveal.globalCompositeOperation = 'destination-in';
    reveal.drawImage(this.revealMask, 0, 0);

    ctx.globalAlpha = this.pointerStrength;
    ctx.drawImage(this.reveal, x, y, REVEAL_RADIUS * 2, REVEAL_RADIUS * 2);
    ctx.globalAlpha = 1;
  }

  /** Keep the page smooth on slow machines by dropping signals. */
  private adapt() {
    if (this.frameMs > SLOW_FRAME_MS) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);

    if (this.slowFrames > 90 && this.pulses.length > 8) {
      this.pulses.length = Math.floor(this.pulses.length * 0.75);
      this.slowFrames = 0;
    }
  }

  private renderHud(force = false) {
    const { telemetry } = this;
    if (!telemetry) return;
    const set = (key: string, value: string) => {
      const element = telemetry.querySelector(`[data-t="${key}"]`);
      if (element) element.textContent = value;
    };
    set('nets', String(this.traces.length));
    set('ms', `${this.routeMs.toFixed(1)} ms`);
    if (this.still) set('fps', 'static');
    else if (!force) set('fps', String(Math.round(1000 / this.frameMs)));
  }

  private toggleXray() {
    this.xrayOn = !this.xrayOn;
    this.telemetry?.setAttribute('aria-pressed', String(this.xrayOn));
    if (this.xrayOn && !this.xray) this.xray = this.makeXray();
    if (this.still) this.draw(0);
  }

  /** Grid, keep-outs and every cell the search explored. */
  private makeXray() {
    const { pitch, router, dpr } = this;
    const layer = makeLayer(this.canvas.width, this.canvas.height);
    const ctx = layer.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const heat = new Uint16Array(router.cols * router.rows);
    let hottest = 1;
    for (const cell of router.visits) hottest = Math.max(hottest, ++heat[cell]);

    for (let y = 0; y < router.rows; y++) {
      for (let x = 0; x < router.cols; x++) {
        const cell = y * router.cols + x;
        const px = x * pitch;
        const py = y * pitch;
        if (router.grid[cell] & 4) {
          ctx.fillStyle = 'rgba(245,110,219,.1)';
          ctx.fillRect(px - pitch / 2, py - pitch / 2, pitch, pitch);
        } else if (heat[cell] > 0) {
          ctx.fillStyle = `rgba(42,140,255,${0.05 + 0.3 * Math.sqrt(heat[cell] / hottest)})`;
          ctx.fillRect(px - pitch / 2 + 1, py - pitch / 2 + 1, pitch - 2, pitch - 2);
        }
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.fillRect(px - 0.75, py - 0.75, 1.5, 1.5);
      }
    }
    return layer;
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const box = this.zone.getBoundingClientRect();
    this.pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  private onPointerLeave = () => {
    this.pointer = null;
  };

  /** Click anywhere on the board to fire a burst of signals down the nearest net. */
  private onClick = (event: MouseEvent) => {
    if (this.growing.length > 0 || (event.target as Element).closest('a, button')) return;
    const box = this.zone.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;

    let nearest: { trace: Trace; at: number } | null = null;
    let best = 120;
    for (const trace of this.traces) {
      for (let i = 1; i < trace.points.length; i++) {
        const a = trace.points[i - 1];
        const b = trace.points[i];
        const span = trace.lengths[i] - trace.lengths[i - 1];
        if (span === 0) continue;
        const t = clamp(((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (span * span), 0, 1);
        const distance = Math.hypot(a.x + (b.x - a.x) * t - x, a.y + (b.y - a.y) * t - y);
        if (distance < best) {
          best = distance;
          nearest = { trace, at: trace.lengths[i - 1] + span * t };
        }
      }
    }
    if (!nearest) return;
    for (let i = 0; i < 3; i++) {
      const speed = this.tuning.speed[1] * 1.8;
      this.pulses.push({ trace: nearest.trace, at: nearest.at, speed, wait: i * 0.09, once: true });
    }
  };
}
