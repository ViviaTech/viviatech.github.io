import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://viviatech.github.io',
  // Astro 7 defaults to JSX whitespace rules, which silently eats spaces between
  // inline elements in prose. Keep HTML rules.
  compressHTML: true,
  integrations: [sitemap()],
  // GitHub Pages can't send response headers, so the policy ships as a <meta> tag.
  // Astro adds the script-src and style-src hashes for each page on top of these.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'none'",
        "object-src 'none'",
      ],
    },
  },
});
