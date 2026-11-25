// The browse tag filter, shared between the home page and the detail page so swiping to the
// next item stays inside the filter. It lives in memory only: a restart shows everything.

/** @typedef {{ tags: string[], untagged: boolean }} BrowseFilter */

/** @type {BrowseFilter} */
let current = { tags: [], untagged: false };

/** @returns {BrowseFilter} */
export function getBrowseFilter() {
  return { tags: [...current.tags], untagged: current.untagged };
}

/** @param {Partial<BrowseFilter>} filter */
export function setBrowseFilter({ tags = [], untagged = false } = {}) {
  current = { tags: untagged ? [] : [...new Set(tags)], untagged: Boolean(untagged) };
  return getBrowseFilter();
}

/** Adds or removes one tag; picking a tag always leaves "untagged only". */
export function toggleBrowseTag(tag) {
  const tags = current.tags.includes(tag) ? current.tags.filter((value) => value !== tag) : [...current.tags, tag];
  return setBrowseFilter({ tags });
}

/** @param {BrowseFilter} filter */
export function describeBrowseFilter(filter) {
  if (filter.untagged) return 'Untagged';
  return filter.tags.join(' + ');
}
