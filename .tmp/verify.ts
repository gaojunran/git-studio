import { GitRunner } from '../src/extension/git/cli';
import { loadCommits } from '../src/extension/git/log';
import { loadRefs } from '../src/extension/git/refs';
import { loadCommitDetail } from '../src/extension/git/commit';
import { loadBlame } from '../src/extension/git/blame';
import { loadDiffFiles } from '../src/extension/git/diff';
import { layoutGraph } from '../src/extension/graph/layout';

const cwd = process.argv[2];
if (!cwd) {
  throw new Error('usage: verify <repo>');
}

const runner = new GitRunner('git');

async function main() {
  const refs = await loadRefs(runner, cwd);
  console.log('refs:', refs.length, refs.slice(0, 5).map((ref) => `${ref.type}:${ref.shortName}${ref.current ? '*' : ''}`));

  const first = await loadCommits(runner, cwd, { refs: [], skip: 0, limit: 20 });
  console.log('commits:', first.rows.length, 'hasMore:', first.hasMore);
  console.log('first row:', JSON.stringify(first.rows[0], null, 2));
  console.log('decorated rows:', first.rows.filter((row) => row.refs.length > 0).length);
  console.log('merge rows:', first.rows.filter((row) => row.parents.length > 1).length);

  const graph = layoutGraph(first.rows);
  console.log('graph rows:', graph.length, 'max lane:', Math.max(...graph.map((row) => row.lane)));
  console.log('graph sample:', JSON.stringify(graph.slice(0, 6)));

  if (first.rows[0]) {
    const detail = await loadCommitDetail(runner, cwd, first.rows[0].hash);
    console.log('detail files:', detail.files.length, 'additions:', detail.additions, 'deletions:', detail.deletions);
    console.log('detail sample:', JSON.stringify(detail.files.slice(0, 3), null, 2));

    const tracked = detail.files.find((file) => file.status !== 'D' && !file.binary);
    if (tracked) {
      const blame = await loadBlame(runner, cwd, tracked.path, { ignoreWhitespace: true, detectMoves: true });
      console.log('blame lines:', blame.length, 'sample:', JSON.stringify(blame[0]));
    }
  }

  const older = first.rows[Math.min(5, first.rows.length - 1)];
  if (older) {
    const diff = await loadDiffFiles(runner, cwd, older.hash, first.rows[0].hash);
    console.log('diff files:', diff.length, 'sample:', JSON.stringify(diff.slice(0, 3)));
  }

  const pathQuery = first.rows[0]?.hash;
  if (pathQuery) {
    const withPath = await loadCommits(runner, cwd, { refs: [], path: 'package.json', follow: true, skip: 0, limit: 10 });
    console.log('path-filtered commits:', withPath.rows.length);
  }
}

main().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
