import { spawn } from 'node:child_process';

export interface GitRunOptions {
  signal?: AbortSignal;
  input?: string;
  maxBuffer?: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
    readonly args: string[]
  ) {
    super(message);
    this.name = 'GitError';
  }
}

function abortError(): Error {
  const error = new Error('Git command aborted');
  error.name = 'AbortError';
  return error;
}

export class GitRunner {
  private gitPath: string;
  private active = 0;
  private readonly maxConcurrent = 4;
  private readonly waiting: (() => void)[] = [];
  private readonly pending = new Map<string, Promise<string>>();

  constructor(gitPath: string, private readonly onCommand?: (line: string) => void) {
    this.gitPath = gitPath;
  }

  setGitPath(gitPath: string): void {
    this.gitPath = gitPath;
  }

  async run(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    const key = JSON.stringify([cwd, args]);
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    const task = this.enqueue(() => this.execute(args, cwd, options));
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> | void {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }

  private execute(args: string[], cwd: string, options: GitRunOptions): Promise<string> {
    this.onCommand?.(`git ${args.join(' ')}`);

    return new Promise<string>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError());
        return;
      }

      const child = spawn(this.gitPath, args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C'
        }
      });

      const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (error: Error | undefined, value?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        if (error) {
          reject(error);
        } else {
          resolve(value ?? '');
        }
      };

      const onAbort = () => {
        child.kill('SIGKILL');
        finish(abortError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > maxBuffer) {
          child.kill('SIGKILL');
          finish(new GitError(`git output exceeded ${maxBuffer} bytes`, -1, '', args));
        }
      });
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8000) {
          stderr += chunk;
        }
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (code === 0) {
          finish(undefined, stdout);
          return;
        }
        finish(
          new GitError(
            `git ${args[0] ?? ''} exited with code ${code}: ${stderr.trim().split('\n')[0] ?? ''}`,
            code ?? -1,
            stderr,
            args
          )
        );
      });

      if (options.input !== undefined) {
        child.stdin.end(options.input);
      } else {
        child.stdin.end();
      }
    });
  }
}
