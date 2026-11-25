import {
  applyTagChange,
  countTags,
  matchesTagFilter,
  normalizeTag,
  parseTagFilter,
  parseTagList
} from '../../../src/lib/tags.mjs';

describe('tags', () => {
  it('stores tags lowercase with single spaces, in any language', () => {
    expect(normalizeTag('  Beach  Day ')).toBe('beach day');
    expect(normalizeTag('Été')).toBe('été');
    expect(normalizeTag('2024')).toBe('2024');
    expect(normalizeTag('top-10_x')).toBe('top-10_x');
  });

  it('rejects empty, too long or punctuated tags', () => {
    for (const bad of ['', '   ', '-start', 'a,b', '<b>', 'x'.repeat(33), 42, null]) {
      expect(normalizeTag(bad)).toBeNull();
    }
  });

  it('parses a tag list without duplicates and rejects bad lists', () => {
    expect(parseTagList(['Beach', 'beach ', 'sun'])).toEqual(['beach', 'sun']);
    expect(parseTagList(undefined)).toEqual([]);
    expect(parseTagList('beach')).toBeNull();
    expect(parseTagList(['ok', 'bad,tag'])).toBeNull();
    expect(parseTagList(['a', 'b', 'c'], 2)).toBeNull();
  });

  it('applies additions and removals, sorted, with removals winning', () => {
    expect(applyTagChange(['sun', 'beach'], { add: ['night', 'sun'], remove: ['beach'] }))
      .toEqual(['night', 'sun']);
    expect(applyTagChange(['a'], { add: ['b'], remove: ['b'] })).toEqual(['a']);
    expect(applyTagChange([], {})).toEqual([]);
  });

  it('reads the browse filter from query parameters', () => {
    expect(parseTagFilter(undefined)).toEqual({ tags: [], untagged: false });
    expect(parseTagFilter({ tags: 'Beach,sun' })).toEqual({ tags: ['beach', 'sun'], untagged: false });
    expect(parseTagFilter({ untagged: '1' })).toEqual({ tags: [], untagged: true });
    expect(parseTagFilter({ tags: 'beach', untagged: '1' })).toBeNull();
    expect(parseTagFilter({ tags: 'bad;tag' })).toBeNull();
  });

  it('keeps items that have every requested tag, or none for untagged', () => {
    const item = { tags: ['beach', 'sun'] };
    expect(matchesTagFilter(item, { tags: ['beach'], untagged: false })).toBe(true);
    expect(matchesTagFilter(item, { tags: ['beach', 'night'], untagged: false })).toBe(false);
    expect(matchesTagFilter(item, { tags: [], untagged: true })).toBe(false);
    expect(matchesTagFilter({}, { tags: [], untagged: true })).toBe(true);
    expect(matchesTagFilter({}, null)).toBe(true);
  });

  it('counts tags, most used first', () => {
    expect(countTags([{ tags: ['b', 'a'] }, { tags: ['a'] }, {}])).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 }
    ]);
  });
});
