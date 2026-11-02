/** Mounts every [data-circuit] canvas and runs them from one animation loop. */

import { Board } from './board';

const CHOICE_KEY = 'vivia-motion';
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const toggles = document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]');
const boards: Board[] = [];
let frame = 0;

// Storage can throw in private windows or with site data blocked.
function savedChoice() {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function saveChoice(choice: string) {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // The choice just won't be remembered.
  }
}

/**
 * The system's reduced motion setting decides the default. Windows also turns it
 * on for "best performance" tuning, which many gaming PCs use, so the toggle lets
 * anyone choose for themselves, and that choice wins from then on.
 */
const shouldPause = () => {
  const choice = savedChoice();
  return choice ? choice === 'paused' : motionQuery.matches;
};

let paused = shouldPause();

function tick(now: number) {
  frame = 0;
  if (paused) return;
  let active = false;
  for (const board of boards) {
    if (!board.visible) continue;
    board.frame(now);
    active = true;
  }
  if (active) frame = requestAnimationFrame(tick);
}

const wake = () => {
  if (!frame && !document.hidden && !paused) frame = requestAnimationFrame(tick);
};

function renderToggles() {
  const label = paused ? 'Play animation' : 'Pause animation';
  for (const toggle of toggles) {
    toggle.dataset.paused = String(paused);
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
}

function setPaused(value: boolean) {
  paused = value;
  for (const board of boards) board.setStill(paused);
  renderToggles();
  wake();
}

document.addEventListener('visibilitychange', wake);
motionQuery.addEventListener('change', () => setPaused(shouldPause()));

for (const toggle of toggles) {
  toggle.addEventListener('click', () => {
    saveChoice(paused ? 'playing' : 'paused');
    setPaused(!paused);
  });
}

function mount(canvas: HTMLCanvasElement) {
  const board = new Board(canvas, paused);
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
  // Shown before mounting, so the board routes around it.
  renderToggles();
  for (const toggle of toggles) toggle.hidden = false;
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-circuit]').forEach(mount);
}

// Keep-outs are measured from text, so wait for the real font (but not for long).
Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 700))]).then(start);
