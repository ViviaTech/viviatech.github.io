let n = 0;

/** Unique id for SVG gradient and filter references on a page. */
export const uid = (prefix: string) => `${prefix}-${(++n).toString(36)}`;
