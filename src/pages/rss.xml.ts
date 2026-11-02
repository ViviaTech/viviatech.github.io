import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts, postUrl } from '../lib/journal';
import { SITE } from '../lib/site';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: 'ViVia Journal',
    description: SITE.tagline,
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: postUrl(post),
    })),
  });
}
