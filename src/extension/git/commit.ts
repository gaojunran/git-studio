import type { CommitDetail } from '../../shared/protocol';
import type { GitRunner } from './cli';
import { loadCommitFiles } from './diff';

const META_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f');

export async function loadCommitDetail(
  runner: GitRunner,
  cwd: string,
  hash: string,
  parentIndex = 0,
  signal?: AbortSignal
): Promise<CommitDetail> {
  const raw = await runner.run(
    ['-c', 'core.quotepath=false', 'show', '-s', `--format=${META_FORMAT}`, hash],
    cwd,
    { signal }
  );

  const fields = raw.replace(/\n$/, '').split('\x1f');
  const [fullHash = hash, parents = '', authorName = '', authorEmail = '', authorDate = '0',
    committerName = '', committerEmail = '', commitDate = '0'] = fields;
  const message = fields.slice(8).join('\x1f');

  const parentsList = parents.split(' ').filter(Boolean);
  const index = Math.max(0, Math.min(parentIndex, Math.max(0, parentsList.length - 1)));
  const parent = parentsList[index];
  const files = await loadCommitFiles(runner, cwd, hash, parent ? [parent] : [], signal);

  return {
    hash: fullHash || hash,
    message,
    parents: parentsList,
    parentIndex: index,
    authorName,
    authorEmail,
    authorDate: Number(authorDate) || 0,
    committerName,
    committerEmail,
    commitDate: Number(commitDate) || 0,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0)
  };
}
