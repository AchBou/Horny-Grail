import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  describeBrowseFilter,
  getBrowseFilter,
  setBrowseFilter,
  toggleBrowseTag
} from '../src/lib/mobile/browseFilter.js';

beforeEach(() => setBrowseFilter({}));

test('starts with everything shown', () => {
  assert.deepEqual(getBrowseFilter(), { tags: [], untagged: false });
});

test('toggling tags adds and removes them and leaves untagged-only', () => {
  setBrowseFilter({ untagged: true });
  toggleBrowseTag('beach');
  assert.deepEqual(getBrowseFilter(), { tags: ['beach'], untagged: false });

  toggleBrowseTag('sun');
  assert.equal(describeBrowseFilter(getBrowseFilter()), 'beach + sun');

  toggleBrowseTag('beach');
  assert.deepEqual(getBrowseFilter().tags, ['sun']);
});

test('untagged-only clears the chosen tags', () => {
  setBrowseFilter({ tags: ['beach'], untagged: true });
  assert.deepEqual(getBrowseFilter(), { tags: [], untagged: true });
  assert.equal(describeBrowseFilter(getBrowseFilter()), 'Untagged');
});

test('callers cannot change the stored filter by editing a copy', () => {
  setBrowseFilter({ tags: ['beach'] });
  getBrowseFilter().tags.push('sneaky');
  assert.deepEqual(getBrowseFilter().tags, ['beach']);
});
