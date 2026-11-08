import { describe, expect, it } from 'vitest';
import { parseRefs } from './refs';

const FIELD = '\x1f';
const RECORD = '\x1e';

describe('parseRefs', () => {
  it('parses upstream ahead/behind counts', () => {
    const stdout = [
      ['refs/heads/feature', 'a'.repeat(40), 'origin/feature', '*', '1700000000', 'feat', '[ahead 2, behind 1]'].join(FIELD),
      ['refs/heads/main', 'b'.repeat(40), '', '', '1690000000', 'main', ''].join(FIELD)
    ].join(RECORD) + RECORD;

    const refs = parseRefs(stdout);
    const feature = refs.find((ref) => ref.shortName === 'feature');
    const main = refs.find((ref) => ref.shortName === 'main');

    expect(feature).toMatchObject({ ahead: 2, behind: 1, current: true });
    expect(main).toMatchObject({ ahead: undefined, behind: undefined, current: false });
  });
});
