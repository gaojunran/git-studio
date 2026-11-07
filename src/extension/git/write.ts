import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import type { RebasePlan } from '../../shared/protocol';
import { GitError, type GitRunner } from './cli';
import { buildRebasePlan, buildTodo, shellQuote, validatePlan } from './rebase';
import { headOid, resolveCommit } from './revision';

export { headOid, resolveCommit } from './revision';

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;

const OPERATION_FILES: [string, Exclude<Operation, null>][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert']
];

export async function gitDir(runner: GitRunner, cwd: string): Promise<string> {
  return (await runner.run(['rev-parse', '--absolute-git-dir'], cwd)).trim();
}

export async function detectOperation(runner: GitRunner, cwd: string): Promise<Operation> {
  const dir = await gitDir(runner, cwd);
  for (const [file, operation] of OPERATION_FILES) {
    if (existsSync(path.join(dir, file))) {
      return operation;
    }
  }
  return null;
}

export function isConflict(error: unknown): boolean {
  return (
    error instanceof GitError &&
    /CONFLICT|could not apply|needs merge|after resolving the conflicts/i.test(`${error.stderr}\n${error.message}`)
  );
}

const ABORT_ARGS: Record<Exclude<Operation, null>, string[]> = {
  merge: ['merge', '--abort'],
  rebase: ['rebase', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort']
};

export class WriteCoordinator {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly runner: GitRunner) {}

  /** Serializes writes per extension host and refuses to start while another operation is mid-flight. */
  run<T>(cwd: string, expectedHead: string | undefined, task: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const operation = await detectOperation(this.runner, cwd);
      if (operation) {
        throw new Error(`${operation} is already in progress. Finish it or abort it first.`);
      }
      const current = await headOid(this.runner, cwd);
      if (current !== expectedHead) {
        throw new Error('HEAD moved while the dialog was open. Refresh and try again.');
      }
      return task();
    });
  }

  async reset(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard', expectedHead: string | undefined): Promise<void> {
    await this.run(cwd, expectedHead, async () => {
      const oid = await resolveCommit(this.runner, cwd, hash);
      await this.runner.run(['reset', `--${mode}`, oid], cwd);
    });
  }

  async revert(cwd: string, hash: string, expectedHead: string | undefined, mainline?: number): Promise<void> {
    await this.run(cwd, expectedHead, async () => {
      const oid = await resolveCommit(this.runner, cwd, hash);
      const args = ['revert', '--no-edit'];
      if (mainline) {
        args.push('-m', String(mainline));
      }
      args.push(oid);
      await this.runner.run(args, cwd);
    });
  }

  async cherryPick(cwd: string, hash: string, expectedHead: string | undefined, mainline?: number): Promise<void> {
    await this.run(cwd, expectedHead, async () => {
      const oid = await resolveCommit(this.runner, cwd, hash);
      const args = ['cherry-pick'];
      if (mainline) {
        args.push('-m', String(mainline));
      }
      args.push(oid);
      await this.runner.run(args, cwd);
    });
  }

  async abort(cwd: string): Promise<void> {
    await this.exclusive(async () => {
      const operation = await detectOperation(this.runner, cwd);
      if (!operation) {
        throw new Error('No operation to abort.');
      }
      await this.runner.run(ABORT_ARGS[operation], cwd);
      await this.cleanupRebaseDir(cwd);
    });
  }

  async rebase(cwd: string, plan: RebasePlan, expectedHead: string | undefined): Promise<'done' | 'stopped'> {
    return this.run(cwd, expectedHead, async () => {
      const fresh = await buildRebasePlan(this.runner, cwd, plan.target);
      if (fresh.error) {
        throw new Error(fresh.error);
      }
      const allowed = new Set(fresh.items.map((item) => item.hash));
      if (plan.items.some((item) => !allowed.has(item.hash))) {
        throw new Error('The commit list changed. Reopen the rebase dialog.');
      }
      const invalid = validatePlan(plan);
      if (invalid) {
        throw new Error(invalid);
      }

      const dir = path.join(await gitDir(this.runner, cwd), 'gitstudio-rebase');
      mkdirSync(dir, { recursive: true });
      const todoPath = path.join(dir, 'todo');
      writeFileSync(todoPath, buildTodo(plan, dir), 'utf8');

      try {
        await this.runner.run(['rebase', '-i', plan.target], cwd, {
          env: {
            GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todoPath)}`,
            GIT_EDITOR: 'true'
          }
        });
        const operation = await detectOperation(this.runner, cwd).catch(() => null);
        if (operation === 'rebase') {
          return 'stopped' as const;
        }
        await this.cleanupRebaseDir(cwd);
        return 'done' as const;
      } catch (error) {
        const operation = await detectOperation(this.runner, cwd).catch(() => null);
        if (operation !== 'rebase') {
          await this.cleanupRebaseDir(cwd);
        }
        throw error;
      }
    });
  }

  async continueOperation(cwd: string): Promise<'done' | 'stopped'> {
    return this.exclusive(async () => {
      const operation = await detectOperation(this.runner, cwd);
      if (!operation) {
        throw new Error('No operation to continue.');
      }
      if (operation === 'merge') {
        throw new Error('Resolve the merge and commit it instead.');
      }
      await this.runner.run(operation === 'rebase' ? ['rebase', '--continue'] : [operation, '--continue'], cwd, {
        env: { GIT_EDITOR: 'true' }
      });
      const remaining = await detectOperation(this.runner, cwd).catch(() => null);
      if (remaining === 'rebase') {
        return 'stopped' as const;
      }
      await this.cleanupRebaseDir(cwd);
      return 'done' as const;
    });
  }

  async skipOperation(cwd: string): Promise<'done' | 'stopped'> {
    return this.exclusive(async () => {
      const operation = await detectOperation(this.runner, cwd);
      if (!operation) {
        throw new Error('No operation to skip.');
      }
      if (operation === 'merge') {
        throw new Error('Resolve the merge and commit it instead.');
      }
      await this.runner.run(operation === 'rebase' ? ['rebase', '--skip'] : [operation, '--skip'], cwd);
      const remaining = await detectOperation(this.runner, cwd).catch(() => null);
      if (remaining === 'rebase') {
        return 'stopped' as const;
      }
      await this.cleanupRebaseDir(cwd);
      return 'done' as const;
    });
  }

  private async cleanupRebaseDir(cwd: string): Promise<void> {
    try {
      const dir = path.join(await gitDir(this.runner, cwd), 'gitstudio-rebase');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: a missing directory or git dir is not an error.
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
