# ViVia Technologies website

The site at [viviatech.github.io](https://viviatech.github.io), built with [Astro](https://astro.build) and deployed to GitHub Pages. It ships as static HTML with no framework JavaScript. The only client code is what's in `src/scripts`.

## Run it

Needs Node 22.23 or newer.

```sh
npm install
npm run dev       # live-reloading dev server
npm run build     # router tests, type check, then a production build in dist/
npm run preview   # serve dist/ locally
npm test          # router tests only
```

## Publish

Push to `main`. The [Deploy workflow](.github/workflows/deploy.yml) tests, builds and publishes it. If the tests or the type check fail, nothing is deployed and the current site stays up.

## Add a journal post

Add a Markdown file to `src/content/journal/`. The filename becomes the URL, so `my-post.md` is published at `/journal/my-post/`.

```md
---
title: The post title
description: One sentence, used on cards and in search results.
category: essays        # news, events or essays
label: Perspective      # short tag shown above the title
date: 2026-11-20
featured: false         # featured posts appear first on the homepage
---

The post, in Markdown.
```

The cover is generated from the filename, the journal page, RSS feed, sitemap and previous/next links update themselves, and the build fails with a clear error if a field is missing.

Event posts can also set `when: 9–12 Nov 2026` and `where: Lisbon, Portugal`, which replace the date and reading time. `showTeam: true` adds the team grid to the end of a post.

## Where things live

| To change | Edit |
| --- | --- |
| Email, phone, links, nav | `src/lib/site.ts` |
| The event in the hero pill | `NEXT_EVENT` in `src/lib/site.ts` (it hides itself after `ends`) |
| Team names, roles, bios, photos | `src/components/Team.astro` and `src/assets/team/` |
| Colours, type, spacing | `src/styles/tokens.css` |
| Homepage sections | `src/components/` and `src/pages/index.astro` |

## The circuit

The animated board on the homepage is a working two-layer PCB autorouter.

- **`src/scripts/circuit/router.ts`** is the router: A* over a grid where the search state is (cell, heading, layer). Heading limits turns to 45° at a time. Layer lets a net drop through a via and pass under another trace. It has no DOM dependency, so it also runs at build time to generate the journal covers (`src/lib/cover.ts`).
- **`src/scripts/circuit/board.ts`** measures the page, routes around any element marked `data-keepout`, feeds nets into the element marked `data-circuit-target`, and animates the signals. Traces are baked into offscreen layers, so each frame only draws the pulses.
- **`src/scripts/circuit/index.ts`** runs all boards from one animation loop, and pauses them off screen and in hidden tabs.

To use one, add `<Circuit mode="calm" />` inside a `position: relative` element. The modes are `hero`, `calm`, `mini` and `broken`.

Try it on the homepage: move the cursor over the board, click to fire a burst of signals, and click the stats in the corner of the hero for an x-ray of the grid, keep-outs and the cells the search explored. With reduced motion enabled, the board is drawn once and stays still.
