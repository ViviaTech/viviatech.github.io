(() => {
	const scriptUrl = new URL(document.currentScript.src);
	const rootUrl = new URL('../', scriptUrl);
	const link = (path) => new URL(path, rootUrl).pathname;

	const footer = document.createElement('footer');
	footer.className = 'journal-footer';
	footer.innerHTML = `
		<div class="journal-footer__inner">
			<div class="journal-footer__main">
				<div class="journal-footer__brand-block">
					<a class="journal-footer__brand" href="${link('index.html')}" aria-label="Back to ViVia home"><img src="${link('Media/ViVa-V-Logo.png')}" alt=""><span>ViVia Technologies</span></a>
					<p>Clearer, more useful technology for people with ambitious ideas.</p>
					<span class="journal-footer__location">Lisbon, Portugal · Est. 2026</span>
				</div>
				<nav class="journal-footer__nav" aria-label="Journal footer navigation">
					<strong>Explore</strong>
					<a href="${link('blogs.html')}">All stories</a>
					<a href="${link('blogs.html')}#news">News</a>
					<a href="${link('blogs.html')}#events">Events</a>
					<a href="${link('blogs.html')}#blogs">Blogs</a>
				</nav>
				<div class="journal-footer__contact">
					<strong>Start a conversation</strong>
					<p>Have an idea worth making clearer?</p>
					<a class="journal-footer__cta" href="${link('index.html')}#contact">Talk to ViVia <b>↗</b></a>
				</div>
			</div>
			<div class="journal-footer__bottom">
				<span>© 2026 ViVia Technologies</span>
				<span>Notes from the workbench, Lisbon</span>
				<a href="#top" class="journal-footer__top">Back to top ↑</a>
			</div>
		</div>`;

	document.body.appendChild(footer);
})();
