import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { RebasePlan } from '../../shared/protocol';
import type { GitRunner } from './cli';
import { headOid, resolveCommit } from './write';

const FIELD = '\x1f';
const RECORD = '\x00';
const FIELD_TOKEN = '%x1f';
const RECORD_TOKEN = '%x00';

export async function buildRebasePlan(runner: GitRunner, cwd: string, target: string): Promise<RebasePlan> {
  const empty = (error: string): RebasePlan => ({
    head: '',
    target: '',
    targetShort: '',
    branch: null,
    items: [],
    error
  });

  let targetOid: string;
  try {
    targetOid = await resolveCommit(runner, cwd, target);
  } catch {
    return empty('Unknown commit.');
  }

  const head = await headOid(runner, cwd);
  if (!head) {
    return empty('The current branch has no commits.');
  }
  if (targetOid === head) {
    return empty('Select a commit before HEAD.');
  }

  const isAncestor = await runner
    .run(['merge-base', '--is-ancestor', targetOid, head], cwd)
    .then(() => true)
    .catch(() => false);
  if (!isAncestor) {
    return empty('The selected commit is not an ancestor of the current branch.');
  }

  const branch = (await runner.run(['symbolic-ref', '--short', '-q', 'HEAD'], cwd).catch(() => '')).trim() || null;
  const format = `%H${FIELD_TOKEN}%h${FIELD_TOKEN}%s${RECORD_TOKEN}`;
  const output = await runner.run(
    ['log', '--reverse', '--no-merges', `--format=${format}`, `${targetOid}..${head}`],
    cwd
  );

  const items = output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', subject = ''] = record.split(FIELD);
      return { hash, shortHash, subject, action: 'pick' as const };
    })
    .filter((item) => item.hash);

  if (items.length === 0) {
    return empty('There are no commits between the selected commit and HEAD.');
  }

  return {
    head,
    target: targetOid,
    targetShort: targetOid.slice(0, 7),
    branch,
    items
  };
}

export function validatePlan(plan: RebasePlan): string | undefined {
  const kept = plan.items.filter((item) => item.action !== 'drop');
  if (kept.length === 0) {
    return 'Keep at least one commit.';
  }
  if (kept[0].action === 'squash' || kept[0].action === 'fixup') {
    return 'The first kept commit cannot be squashed or fixed up.';
  }
  if (plan.items.some((item) => item.action === 'reword' && !(item.message ?? '').trim())) {
    return 'Every reword needs a message.';
  }
  return undefined;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildTodo(plan: RebasePlan, dir: string): string {
  const lines: string[] = [];
  for (const item of plan.items) {
    if (item.action === 'drop') {
      continue;
    }

    if (item.action === 'reword') {
      const messagePath = path.join(dir, `${item.hash}.msg`);
      writeFileSync(messagePath, `${(item.message ?? item.subject).trim()}\n`, 'utf8');
      lines.push(`pick ${item.hash}`);
      lines.push(`exec git commit --amend -F ${shellQuote(messagePath)}`);
      continue;
    }

    lines.push(`${item.action} ${item.hash}`);
  }
  return `${lines.join('\n')}\n`;
}
