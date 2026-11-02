/** Mounts every [data-circuit] canvas and runs them from one animation loop. */

import { Board } from './board';

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const boards: Board[] = [];
let frame = 0;

function tick(now: number) {
  frame = 0;
  let active = false;
  for (const board of boards) {
    if (!board.visible) continue;
    board.frame(now);
    active = true;
  }
  if (active) frame = requestAnimationFrame(tick);
}

const wake = () => {
  if (!frame && !document.hidden && !motionQuery.matches) frame = requestAnimationFrame(tick);
};

document.addEventListener('visibilitychange', wake);

function mount(canvas: HTMLCanvasElement) {
  const still = motionQuery.matches;
  const board = new Board(canvas, still);
  let built = false;

  const observer = new IntersectionObserver(([entry]) => {
    board.visible = entry.isIntersecting;
    if (!entry.isIntersecting) return;
    // Build on first sight: the intro should play when someone can see it.
    if (!built) {
      built = true;
      board.build(true);
    }
    wake();
  });
  observer.observe(canvas);

  let timer = 0;
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Ignore the small height changes from mobile browser bars appearing.
      const widthChanged = Math.abs(canvas.clientWidth - width) > 2;
      const heightChanged = Math.abs(canvas.clientHeight - height) > 120;
      if (!built || (!widthChanged && !heightChanged)) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      board.build(false);
      wake();
    }, 220);
  }).observe(canvas);

  boards.push(board);
}

function start() {
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-circuit]').forEach(mount);
}

// Keep-outs are measured from text, so wait for the real font (but not for long).
Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 700))]).then(start);
