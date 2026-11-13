/** Single source of truth for facts repeated across the site. */
export const SITE = {
  name: 'ViVia Technologies',
  short: 'ViVia',
  url: 'https://viviatech.github.io',
  description:
    'ViVia is a small digital studio in Lisbon. We bring design, engineering and curiosity together to turn ambitious ideas into websites, products and hardware people can trust.',
  tagline: 'Clearer, more useful technology for people with ambitious ideas.',
  email: 'general@viviatechnologies.com',
  phone: '+351 928 214 629',
  phoneHref: 'tel:+351928214629',
  github: 'https://github.com/ViviaTech',
  location: 'Lisbon, Portugal',
  founded: 2026,
} as const;

export const NAV = [
  { label: 'About', href: '/#about' },
  { label: 'Services', href: '/#services' },
  { label: 'Team', href: '/#team' },
  { label: 'Journal', href: '/#journal' },
] as const;

export const CATEGORIES = {
  news: 'News',
  events: 'Events',
  essays: 'Essays',
} as const;

/** The hero pill promotes this until it ends, then falls back by itself. */
export const NEXT_EVENT = {
  label: 'Meet us at Web Summit Lisbon',
  dates: '9–12 Nov',
  href: '/journal/vivia-at-websummit/',
  ends: '2026-11-13T00:00:00Z',
} as const;
