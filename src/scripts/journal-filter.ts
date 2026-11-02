/** Category filter on the journal page, with #news-style deep links. */

const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
const posts = [...document.querySelectorAll<HTMLElement>('[data-category]')];

// #blogs is the old name for this category; those links are already out there.
const ALIASES: Record<string, string> = { blogs: 'essays' };

function select(filter: string) {
  const known = buttons.some((button) => button.dataset.filter === filter);
  const active = known ? filter : 'all';
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === active));
  }
  for (const post of posts) {
    post.hidden = active !== 'all' && post.dataset.category !== active;
  }
}

function fromHash() {
  const hash = location.hash.slice(1);
  select(ALIASES[hash] ?? hash);
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter ?? 'all';
    select(filter);
    history.replaceState(null, '', filter === 'all' ? location.pathname : `#${filter}`);
  });
}

window.addEventListener('hashchange', fromHash);
fromHash();
