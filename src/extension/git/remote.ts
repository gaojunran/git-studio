export function normalizeRemoteUrl(raw: string): string | undefined {
  let value = raw.trim();
  if (!value) {
    return undefined;
  }

  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
  if (scp && !value.includes('://')) {
    value = `https://${scp[1]}/${scp[2]}`;
  }

  value = value
    .replace(/^git\+ssh:\/\//, 'https://')
    .replace(/^ssh:\/\/(?:[^@/]+@)?/, 'https://')
    .replace(/^git:\/\//, 'https://');

  if (!/^https?:\/\//.test(value)) {
    return undefined;
  }

  return value.replace(/\.git$/, '').replace(/\/+$/, '');
}

export function commitUrl(remoteUrl: string, hash: string): string | undefined {
  const base = normalizeRemoteUrl(remoteUrl);
  if (!base) {
    return undefined;
  }

  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return undefined;
  }

  if (host === 'github.com' || host.endsWith('.github.com')) {
    return `${base}/commit/${hash}`;
  }
  if (host === 'gitlab.com' || host.includes('gitlab')) {
    return `${base}/-/commit/${hash}`;
  }
  if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) {
    return `${base}/commits/${hash}`;
  }
  return undefined;
}

export function pickRemoteUrl(remotes: readonly { readonly name: string; readonly fetchUrl?: string; readonly pushUrl?: string }[]): string | undefined {
  const preferred = remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
  return preferred?.fetchUrl ?? preferred?.pushUrl;
}
