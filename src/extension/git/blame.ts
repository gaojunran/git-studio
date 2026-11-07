import type { GitRunner } from './cli';

export interface BlameLine {
  line: number;
  hash: string;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
}

const HEADER = /^[0-9a-f]{40,64} \d+ \d+( \d+)?$/;

export function parseBlamePorcelain(stdout: string): BlameLine[] {
  const lines: BlameLine[] = [];
  let current: BlameLine | undefined;

  for (const raw of stdout.split('\n')) {
    if (HEADER.test(raw)) {
      const parts = raw.split(' ');
      current = {
        line: Number(parts[2]) || 0,
        hash: parts[0] ?? '',
        author: '',
        authorMail: '',
        authorTime: 0,
        summary: ''
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (raw.startsWith('\t')) {
      if (current.line > 0 && current.hash) {
        lines.push(current);
      }
      current = undefined;
      continue;
    }

    if (raw.startsWith('author-mail ')) {
      current.authorMail = raw.slice('author-mail '.length).replace(/^<|>$/g, '');
    } else if (raw.startsWith('author-time ')) {
      current.authorTime = Number(raw.slice('author-time '.length)) || 0;
    } else if (raw.startsWith('author ')) {
      current.author = raw.slice('author '.length);
    } else if (raw.startsWith('summary ')) {
      current.summary = raw.slice('summary '.length);
    }
  }

  return lines;
}

export async function loadBlame(
  runner: GitRunner,
  cwd: string,
  filePath: string,
  options: { ignoreWhitespace?: boolean; detectMoves?: boolean } = {},
  signal?: AbortSignal
): Promise<BlameLine[]> {
  const args = ['blame', '--line-porcelain'];
  if (options.ignoreWhitespace) {
    args.push('-w');
  }
  if (options.detectMoves) {
    args.push('-M');
  }
  args.push('--', filePath);

  const stdout = await runner.run(args, cwd, { signal });
  return parseBlamePorcelain(stdout);
}
