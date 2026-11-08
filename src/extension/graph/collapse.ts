import type { CommitRow } from '../../shared/protocol';
import { layoutGraph } from './layout';

/**
 * Keep the mainline and every commit that carries a ref or a merge, plus the
 * ends of the fetched window. Interior commits of linear side branches are
 * dropped, which is what "collapse linear branches" means in the log.
 */
export function collapseLinearRows(rows: CommitRow[]): CommitRow[] {
  const graph = layoutGraph(rows);
  return rows.filter(
    (row, index) =>
      graph[index]?.lane === 0 ||
      row.refs.length > 0 ||
      row.parents.length > 1 ||
      index === 0 ||
      index === rows.length - 1
  );
}
