/** Site-wide behaviour. Everything here is an enhancement: pages work without it. */

const header = document.querySelector<HTMLElement>('[data-header]');

// Header background appears once the page has scrolled.
if (header) {
  const update = () => header.classList.toggle('is-stuck', window.scrollY > 8);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// Mobile menu. <dialog> provides the focus trap and Esc to close.
const menu = document.querySelector<HTMLDialogElement>('[data-menu]');
document.querySelector('[data-menu-open]')?.addEventListener('click', () => menu?.showModal());
document.querySelector('[data-menu-close]')?.addEventListener('click', () => menu?.close());
menu?.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) menu.close();
});

// Scroll-spy for the homepage sections.
const spyLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-spy]')];
const spyTargets = spyLinks
  .map((link) => document.getElementById(link.hash.slice(1)))
  .filter((section): section is HTMLElement => section !== null);

if (spyTargets.length > 0) {
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of spyLinks) {
          const active = link.hash === `#${entry.target.id}`;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  spyTargets.forEach((section) => spy.observe(section));
}

// Copy buttons.
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  const label = button.textContent;
  let timer = 0;
  button.addEventListener('click', async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Press Ctrl+C';
    }
    timer = window.setTimeout(() => (button.textContent = label), 1600);
  });
});

// Card glow follows the pointer.
document.querySelectorAll<HTMLElement>('.spot').forEach((card) => {
  card.addEventListener(
    'pointermove',
    (event) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    },
    { passive: true },
  );
});

// Content with an end date (the hero's event pill) swaps itself after it passes,
// so a stale announcement can't outlive the last deploy.
document.querySelectorAll<HTMLElement>('[data-until]').forEach((element) => {
  if (Date.now() < Date.parse(element.dataset.until ?? '')) return;
  element.hidden = true;
  element.nextElementSibling?.removeAttribute('hidden');
});

// Reading progress on articles.
const progress = document.querySelector<HTMLElement>('[data-progress]');
if (progress) {
  const update = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.setProperty('--progress', String(scrollable > 0 ? window.scrollY / scrollable : 0));
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}
