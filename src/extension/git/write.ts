import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { GitError, type GitRunner } from './cli';

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

export async function headOid(runner: GitRunner, cwd: string): Promise<string | undefined> {
  try {
    return (await runner.run(['rev-parse', '--verify', 'HEAD'], cwd)).trim();
  } catch {
    return undefined;
  }
}

export async function resolveCommit(runner: GitRunner, cwd: string, revision: string): Promise<string> {
  const oid = (await runner.run(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], cwd)).trim();
  if (!oid) {
    throw new Error(`Unknown revision: ${revision}`);
  }
  return oid;
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
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
