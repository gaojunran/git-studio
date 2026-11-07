import { describe, expect, it } from 'vitest';
import { parseNameStatus, parseNumStat } from './diff';

describe('parseNameStatus', () => {
  it('parses modified, added, deleted and renamed entries', () => {
    const output = 'M\x00src/a.ts\x00A\x00src/b.ts\x00D\x00src/c.ts\x00R100\x00src/old.ts\x00src/new.ts\x00';

    const result = parseNameStatus(output);

    expect(result.get('src/a.ts')).toEqual({ status: 'M' });
    expect(result.get('src/b.ts')).toEqual({ status: 'A' });
    expect(result.get('src/c.ts')).toEqual({ status: 'D' });
    expect(result.get('src/new.ts')).toEqual({ status: 'R', oldPath: 'src/old.ts' });
  });
});

describe('parseNumStat', () => {
  it('parses normal, binary and renamed entries', () => {
    const output = '1\t2\tsrc/a.ts\x003\t4\t\x00src/old.ts\x00src/new.ts\x00-\t-\timg.png\x00';

    const result = parseNumStat(output);

    expect(result.get('src/a.ts')).toEqual({ additions: 1, deletions: 2, binary: false });
    expect(result.get('src/new.ts')).toEqual({ additions: 3, deletions: 4, binary: false });
    expect(result.get('img.png')).toEqual({ additions: 0, deletions: 0, binary: true });
  });
});
