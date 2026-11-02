import { createRandom, hashSeed, planNets, Router, simplify, type NetCell } from '../scripts/circuit/router';

const WIDTH = 1200;
const HEIGHT = 660;
const PITCH = 30;

const line = (cells: NetCell[]) =>
  cells.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x * PITCH} ${y * PITCH}`).join('');

const dot = (x: number, y: number, r: number) =>
  `M${x * PITCH - r} ${y * PITCH}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

/**
 * A unique board for each post, generated from its slug by the same router that
 * drives the homepage. Runs at build time, so covers cost no JavaScript.
 */
export function generateCover(slug: string) {
  const random = createRandom(hashSeed(slug));
  const cols = WIDTH / PITCH + 1;
  const rows = HEIGHT / PITCH + 1;
  const router = new Router({ cols, rows, hug: 0.72 });

  const focus = {
    x: Math.round(cols * (0.3 + random() * 0.4)),
    y: Math.round(rows * (0.32 + random() * 0.36)),
  };
  router.blockCircle(focus.x, focus.y, 3.6);

  let top = '';
  let bottom = '';
  let pads = '';
  let vias = '';

  for (const { from, to } of planNets(router, random, 46)) {
    const cells = router.route(from, to);
    if (!cells) continue;

    const corners = simplify(cells);
    let run: NetCell[] = [corners[0]];
    for (let i = 1; i < corners.length; i++) {
      if (corners[i].layer === run[0].layer) {
        run.push(corners[i]);
        continue;
      }
      if (run[0].layer === 0) top += line(run);
      else bottom += line(run);
      vias += dot(corners[i].x, corners[i].y, 5);
      run = [corners[i]];
    }
    if (run[0].layer === 0) top += line(run);
    else bottom += line(run);

    const end = corners[corners.length - 1];
    pads += dot(end.x, end.y, 4.5);
  }

  const angle = random() * Math.PI * 2;
  const reach = 720;
  return {
    width: WIDTH,
    height: HEIGHT,
    top,
    bottom,
    pads,
    vias,
    focus: { x: focus.x * PITCH, y: focus.y * PITCH },
    gradient: {
      x1: Math.round(WIDTH / 2 - Math.cos(angle) * reach),
      y1: Math.round(HEIGHT / 2 - Math.sin(angle) * reach),
      x2: Math.round(WIDTH / 2 + Math.cos(angle) * reach),
      y2: Math.round(HEIGHT / 2 + Math.sin(angle) * reach),
    },
  };
}
