(() => {
	const articlePaths = window.NEWSLETTER_ARTICLES || [];
	const cache = new Map();
	const parser = new DOMParser();

	const readArticle = async (path) => {
		if (!cache.has(path)) {
			cache.set(path, fetch(path).then((response) => {
				if (!response.ok) throw new Error(`Could not load ${path}`);
				return response.text();
			}).then((html) => {
				const document = parser.parseFromString(html, 'text/html');
				const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';
				return { path, category: meta('category'), featured: meta('featured') === 'true', title: meta('title') || document.querySelector('h1')?.textContent.trim(), description: meta('description') || document.querySelector('.article-dek')?.textContent.trim(), image: meta('image'), label: meta('label'), date: meta('date'), source: document };
			}));
		}
		return cache.get(path);
	};

	const storyCard = (article, index, featured = false) => `<a class="feature-card${featured && index === 0 ? ' feature-card--large' : ''}" href="${article.path}"><div class="card-image"><img src="${article.image}" alt=""><span class="card-number">0${index + 1}</span></div><div class="card-copy"><p class="tag">${article.label}</p><h3>${article.title}</h3><p>${article.description}</p><span class="read-more">Read story <b>↗</b></span></div></a>`;
	const archiveCard = (article, index) => `<a class="archive-card" href="${article.path}"><img src="${article.image}" alt=""><span class="archive-index">0${index + 1}</span><div><p class="tag">${article.label}</p><h3>${article.title}</h3><p>${article.description}</p><span class="read-more">Read story <b>↗</b></span></div></a>`;
	const miniStory = (article) => `<a class="mini-story" href="${article.path}"><img src="${article.image}" alt=""><span><b>${article.category}</b><strong>${article.title}</strong><small>${article.date}</small></span></a>`;
	const newsletterCard = (article, index) => `<article class="newsletter-card"><span>0${index + 1} / ${article.label.toUpperCase()}</span><h3>${article.title}</h3><p>${article.description}</p><a href="${article.path}" aria-label="Read ${article.title}">Read note <b>↗</b></a></article>`;

	const render = async () => {
		const articles = (await Promise.all(articlePaths.map(readArticle))).filter(Boolean);
		const featured = articles.filter((article) => article.featured).slice(0, 3);
		const archive = articles.filter((article) => !article.featured);
		const homepageGrid = document.querySelector('[data-newsletter-grid]');
		if (homepageGrid) homepageGrid.innerHTML = featured.map(newsletterCard).join('');
		const journalGrid = document.querySelector('[data-featured-grid]');
		if (!journalGrid) return;
		journalGrid.innerHTML = featured.map((article, index) => storyCard(article, index, true)).join('');
		document.querySelector('[data-archive-list]').innerHTML = archive.slice(0, 3).map(miniStory).join('');
		['featured', 'news', 'events', 'blogs'].forEach((category) => {
			const count = category === 'featured' ? featured.length : articles.filter((article) => article.category === category).length;
			document.querySelector(`[data-count="${category}"]`).textContent = String(count).padStart(2, '0');
		});
		['news', 'events', 'blogs'].forEach((category) => { document.querySelector(`[data-list="${category}"]`).innerHTML = articles.filter((article) => article.category === category).map(archiveCard).join(''); });
	};

	document.querySelectorAll('.category-button').forEach((button) => button.addEventListener('click', () => {
		const category = button.dataset.category;
		document.querySelectorAll('.category-button').forEach((item) => item.classList.toggle('is-active', item === button));
		document.querySelectorAll('.journal-view').forEach((view) => view.classList.toggle('is-visible', view.dataset.view === category));
	}));

	if (document.querySelector('[data-featured-grid]')) render().catch((error) => console.error('Newsletter could not load:', error));
})();
