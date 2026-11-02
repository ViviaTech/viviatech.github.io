import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'journal'>;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatDate = (date: Date) => dateFormat.format(date);

/** Newest first. */
export const getPosts = async () =>
  (await getCollection('journal')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

/** Featured posts first, then the newest of the rest. */
export const getHomepagePosts = async (limit = 3) => {
  const posts = await getPosts();
  return [...posts.filter((p) => p.data.featured), ...posts.filter((p) => !p.data.featured)].slice(0, limit);
};

export const postUrl = (post: Post) => `/journal/${post.id}/`;

export const readingTime = (post: Post) => {
  const words = post.body?.trim().split(/\s+/).length ?? 0;
  return `${Math.max(1, Math.round(words / 200))} min read`;
};
