import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from './search';

describe('parseSearchQuery', () => {
  it('extracts metadata tokens and keeps free text', () => {
    const query = parseSearchQuery('fix author:"Ada Lovelace" path:src since:2024-01-01 is:no-merge');
    expect(query).toMatchObject({
      text: 'fix',
      author: 'Ada Lovelace',
      path: 'src',
      since: '2024-01-01',
      noMerges: true
    });
  });

  it('supports merge-only and hash lookups', () => {
    expect(parseSearchQuery('is:merge')).toMatchObject({ mergesOnly: true, noMerges: false });
    expect(parseSearchQuery('hash:abc1234')).toMatchObject({ hash: 'abc1234', text: '' });
  });

  it('treats unknown prefixes as text', () => {
    expect(parseSearchQuery('http://example.com')).toMatchObject({ text: 'http://example.com' });
  });
});
