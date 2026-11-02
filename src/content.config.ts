import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const journal = defineCollection({
  loader: glob({ base: './src/content/journal', pattern: '**/*.md' }),
  schema: z.object({
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
  }),
});

export const collections = { journal };
