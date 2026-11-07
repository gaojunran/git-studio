import type { RepoHandle } from '../host/repoService';
import type { Services } from '../host/services';

export async function mergeBaseOf(
  services: Services,
  repo: RepoHandle,
  left: string,
  right: string
): Promise<string | undefined> {
  const output = await services.runner.run(['merge-base', left, right], repo.root).catch(() => '');
  return output.trim().split('\n')[0] || undefined;
}

export function mergeBaseLabel(ref: string): string {
  return ref === 'HEAD' ? 'HEAD' : `merge-base(${ref})`;
}
