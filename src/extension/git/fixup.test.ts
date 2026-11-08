import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitRunner } from './cli';
import { buildRebasePlan } from './rebase';
import { headOid, WriteCoordinator } from './write';

const dirs: string[] = [];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitstudio-fixup-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'a@example.com');
  git('config', 'user.name', 'A');
  writeFileSync(join(dir, 'f.txt'), 'one\n');
  git('add', 'f.txt');
  git('commit', '-qm', 'A');
  writeFileSync(join(dir, 'f.txt'), 'two\n');
  writeFileSync(join(dir, 'g.txt'), 'b\n');
  git('add', 'g.txt');
  git('commit', '-qam', 'B');
  writeFileSync(join(dir, 'f.txt'), 'three\n');
  git('commit', '-qam', 'C');
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('WriteCoordinator fixup', () => {
  it('folds staged changes into an older commit', async () => {
    const dir = repo();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    const a = git('rev-parse', 'HEAD~2');
    const b = git('rev-parse', 'HEAD~1');
    writeFileSync(join(dir, 'g.txt'), 'b\nstaged\n');
    git('add', 'g.txt');

    const runner = new GitRunner('git');
    const writes = new WriteCoordinator(runner);
    const before = await headOid(runner, dir);
    await writes.createFixupCommit(dir, b, 'fixup', before);
    const fixupHash = await headOid(runner, dir);

    const plan = await buildRebasePlan(runner, dir, a);
    expect(plan.error).toBeUndefined();
    const item = plan.items.find((candidate) => candidate.hash === fixupHash);
    const targetIndex = plan.items.findIndex((candidate) => candidate.hash === b);
    expect(item).toBeDefined();
    expect(targetIndex).toBe(0);
    item!.action = 'fixup';
    plan.items = plan.items.filter((candidate) => candidate !== item);
    plan.items.splice(targetIndex + 1, 0, item!);

    await writes.rebase(dir, plan, fixupHash);

    expect(git('rev-list', '--count', 'HEAD')).toBe('3');
    expect(git('show', 'HEAD~1:g.txt')).toContain('staged');
  });
  it('drops one file from a commit through the rebase todo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitstudio-dropfile-'));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'a@example.com');
    git('config', 'user.name', 'A');
    writeFileSync(join(dir, 'f.txt'), 'one\n');
    writeFileSync(join(dir, 'g.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'A');
    writeFileSync(join(dir, 'f.txt'), 'two\n');
    writeFileSync(join(dir, 'h.txt'), 'new\n');
    git('add', '.');
    git('commit', '-qm', 'B');
    const b = git('rev-parse', 'HEAD');

    const runner = new GitRunner('git');
    const writes = new WriteCoordinator(runner);
    const plan = await buildRebasePlan(runner, dir, git('rev-parse', 'HEAD~1'));
    const item = plan.items.find((candidate) => candidate.hash === b);
    item!.dropFile = 'f.txt';

    await writes.rebase(dir, plan, git('rev-parse', 'HEAD'));

    expect(git('show', 'HEAD:f.txt')).toBe('one');
    expect(git('show', 'HEAD:h.txt')).toBe('new');
  });
});
