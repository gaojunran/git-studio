import { describe, expect, it } from 'vitest';
import { parseBlamePorcelain } from './blame';

describe('parseBlamePorcelain', () => {
  it('parses one entry per blamed line', () => {
    const hashA = 'a'.repeat(40);
    const hashB = 'b'.repeat(40);
    const stdout = [
      `${hashA} 1 1 2`,
      'author Ann',
      'author-mail <ann@example.com>',
      'author-time 1700000000',
      'author-tz +0800',
      'author-email <ann@example.com>',
      'summary feat: add blame',
      'filename src/a.ts',
      '\tconst a = 1;',
      `${hashA} 2 2`,
      'author Ann',
      'author-mail <ann@example.com>',
      'author-time 1700000000',
      'summary feat: add blame',
      'filename src/a.ts',
      '\tconst b = 2;',
      `${hashB} 3 3`,
      'author Bob',
      'author-mail <bob@example.com>',
      'author-time 1690000000',
      'summary fix: something',
      'filename src/a.ts',
      '\tconst c = 3;',
      ''
    ].join('\n');

    const lines = parseBlamePorcelain(stdout);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      line: 1,
      hash: hashA,
      author: 'Ann',
      authorMail: 'ann@example.com',
      authorTime: 1700000000,
      summary: 'feat: add blame'
    });
    expect(lines[2]).toMatchObject({ line: 3, hash: hashB, author: 'Bob' });
  });

  it('supports sha-256 length hashes', () => {
    const hash = 'c'.repeat(64);
    const stdout = [
      `${hash} 1 1 1`,
      'author A',
      'author-mail <a@b>',
      'author-time 1',
      'summary s',
      '\tline'
    ].join('\n');

    expect(parseBlamePorcelain(stdout)[0]).toMatchObject({ hash, line: 1 });
  });
});
