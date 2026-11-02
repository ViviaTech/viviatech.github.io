import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '**/*.md' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['news', 'events', 'essays']),
    /** Short tag shown on cards, e.g. "Perspective". */
    label: z.string(),
    date: z.coerce.date(),
    /** Featured posts are shown first on the homepage. */
    featured: z.boolean().default(false),
    /** Event posts: shown instead of the reading time. */
    when: z.string().optional(),
    where: z.string().optional(),
    /** Adds the team grid to the end of the post. */
    showTeam: z.boolean().default(false),
    /** Cover image, relative to the post. Without one, a circuit is generated. */
    cover: image().optional(),
    coverAlt: z.string().optional(),
    /** `cover` fills the frame. `contain` shows a logo whole, over a circuit. */
    coverFit: z.enum(['cover', 'contain']).default('cover'),
  }).refine((post) => !post.cover || post.coverAlt, {
    message: 'A post with a cover also needs coverAlt.',
    path: ['coverAlt'],
  }),
});

export const collections = { journal };
