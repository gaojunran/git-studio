import type { GitRunner } from './cli';

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
