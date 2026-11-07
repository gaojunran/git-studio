import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { GuestManifest } from './manifest';
import type { GuestRecord } from './store';

const WIRE_VERSION = 1;
const PROVIDER_PATH = '/source-control';
const OUTBOUND_PATH = '/source-control/outbound';
const RESPONSE_MAX = 8_000_000;

interface Credential {
  token: string;
  login?: string;
}

interface OutboundHandle {
  origin: string;
  credential: Credential | null;
  header: GuestManifest['descriptor']['token']['header'];
  scheme: GuestManifest['descriptor']['token']['scheme'];
  methods: Set<string>;
  deadline: number;
}

interface Runtime {
  child: ChildProcess;
  port: number;
  token: string;
  ready: Promise<void>;
}

interface ServiceAnswer {
  ok: boolean;
  data?: unknown;
  error?: { message?: string; status?: number; code?: string };
}

function allowlistedEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SystemRoot', 'ComSpec', 'WINDIR', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export class GuestService {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly handles = new Map<string, OutboundHandle>();
  private callback: http.Server | undefined;
  private callbackUrl: string | undefined;

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly storageRoot: vscode.Uri,
    private readonly secrets: vscode.SecretStorage
  ) {}

  tokenKey(record: GuestRecord): string {
    return `gitStudio.board.guest.${record.id}.token`;
  }

  usernameKey(record: GuestRecord): string {
    return `gitStudio.board.guest.${record.id}.username`;
  }

  async connect(record: GuestRecord, token: string, login?: string): Promise<void> {
    await this.request(record, 'auth.verify', {}, { token, login });
    await this.secrets.store(this.tokenKey(record), token);
    if (login) {
      await this.secrets.store(this.usernameKey(record), login);
    } else {
      await this.secrets.delete(this.usernameKey(record));
    }
  }

  async disconnect(record: GuestRecord): Promise<void> {
    await this.secrets.delete(this.tokenKey(record));
    await this.secrets.delete(this.usernameKey(record));
    await this.stop(record.id);
  }

  async credential(record: GuestRecord): Promise<Credential | null> {
    const token = await this.secrets.get(this.tokenKey(record));
    if (!token) {
      return null;
    }
    const login = await this.secrets.get(this.usernameKey(record));
    return { token, login: login ?? undefined };
  }

  async request(record: GuestRecord, method: string, input: Record<string, unknown>, credential?: Credential | null): Promise<unknown> {
    const runtime = await this.ensure(record);
    const active = credential === undefined ? await this.credential(record) : credential;
    const handle = this.mintHandle(record, active);
    const body = JSON.stringify({
      v: WIRE_VERSION,
      requestId: randomUUID(),
      method,
      provider: `ext-${record.id}`,
      session: {
        instance: record.instance,
        handle,
        user: null
      },
      input
    });

    const answer = await new Promise<ServiceAnswer>((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: runtime.port,
          path: PROVIDER_PATH,
          method: 'POST',
          headers: {
            authorization: `Bearer ${runtime.token}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body)
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= RESPONSE_MAX) {
              chunks.push(chunk);
            }
          });
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              resolve(JSON.parse(text) as ServiceAnswer);
            } catch {
              reject(new Error(`Integration service answered HTTP ${response.statusCode} with unreadable JSON`));
            }
          });
        }
      );
      request.on('error', reject);
      request.setTimeout(30_000, () => request.destroy(new Error('Integration service timed out')));
      request.end(body);
    });

    this.handles.delete(handle);
    if (!answer.ok) {
      const error = new Error(answer.error?.message ?? 'Integration service refused the call') as Error & { status?: number; code?: string };
      error.status = answer.error?.status;
      error.code = answer.error?.code;
      throw error;
    }
    return answer.data;
  }

  async mutate(
    record: GuestRecord,
    kind: string,
    input: Record<string, unknown>,
    context: Record<string, unknown>,
    route: string
  ): Promise<Record<string, unknown>> {
    const resolved = await this.request(record, 'mutation.resolveTarget', { context, kind, input });
    try {
      const result = await this.request(record, 'mutation.perform', { route, kind, input, resolved });
      return (result ?? {}) as Record<string, unknown>;
    } catch (error) {
      const status = (error as { status?: number }).status;
      const definite = status !== undefined && status >= 400 && status < 500;
      if (definite) {
        throw error;
      }
      try {
        const reconciled = (await this.request(record, 'mutation.reconcile', { route, kind, input, resolved })) as {
          state?: string;
          result?: Record<string, unknown>;
        };
        if (reconciled.state === 'succeeded') {
          return reconciled.result ?? {};
        }
        if (reconciled.state === 'failed') {
          throw error;
        }
      } catch {
        // A reconcile that cannot answer leaves the original failure as the truth.
      }
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    this.runtimes.delete(id);
    if (runtime) {
      runtime.child.kill();
    }
  }

  async dispose(): Promise<void> {
    for (const id of [...this.runtimes.keys()]) {
      await this.stop(id);
    }
    const callback = this.callback;
    this.callback = undefined;
    if (callback) {
      callback.closeAllConnections?.();
      await new Promise<void>((resolve) => callback.close(() => resolve()));
    }
  }

  private mintHandle(record: GuestRecord, credential: Credential | null): string {
    const handle = randomUUID();
    this.handles.set(handle, {
      origin: new URL(record.instance).origin,
      credential,
      header: record.descriptor.token.header,
      scheme: record.descriptor.token.scheme,
      methods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      deadline: Date.now() + 30_000
    });
    return handle;
  }

  private async ensureCallback(): Promise<string> {
    if (this.callbackUrl) {
      return this.callbackUrl;
    }
    const server = http.createServer((request, response) => {
      void this.handleCallback(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not start the integration callback listener');
    }
    this.callback = server;
    this.callbackUrl = `http://127.0.0.1:${address.port}`;
    return this.callbackUrl;
  }

  private async handleCallback(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(text);
    };
    if (request.url !== OUTBOUND_PATH || request.method !== 'POST') {
      send(404, { error: { message: 'Unknown callback route', code: 'NOT_FOUND' } });
      return;
    }
    if (request.headers.origin !== undefined) {
      send(403, { error: { message: 'Browsers cannot call this listener', code: 'BAD_ORIGIN' } });
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const handleId = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const handle = this.handles.get(handleId);
    if (!handle || handle.deadline < Date.now()) {
      send(401, { error: { message: 'Unknown or expired handle', code: 'HANDLE_UNKNOWN' } });
      return;
    }

    const text = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    let body: { method?: string; path?: string; query?: Record<string, string>; headers?: Record<string, string>; body?: string };
    try {
      body = JSON.parse(text);
    } catch {
      send(400, { error: { message: 'The request body is not JSON', code: 'BAD_REQUEST' } });
      return;
    }
    const method = (body.method ?? 'GET').toUpperCase();
    if (!handle.methods.has(method)) {
      send(403, { error: { message: `Method ${method} is not allowed`, code: 'METHOD_NOT_ALLOWED' } });
      return;
    }
    if (!body.path || !body.path.startsWith('/') || body.path.startsWith('//')) {
      send(400, { error: { message: 'The path must stay on the instance', code: 'BAD_PATH' } });
      return;
    }

    const url = new URL(body.path, handle.origin);
    if (url.origin !== handle.origin) {
      send(403, { error: { message: 'The path is off the instance', code: 'BAD_ORIGIN' } });
      return;
    }
    for (const [key, value] of Object.entries(body.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {};
    for (const key of ['accept', 'content-type', 'if-none-match', 'range']) {
      const value = body.headers?.[key];
      if (value) {
        headers[key] = value;
      }
    }
    if (handle.credential) {
      const { token, login } = handle.credential;
      if (handle.header === 'private-token') {
        headers['private-token'] = token;
      } else if (handle.scheme === 'basic') {
        headers.authorization = `Basic ${Buffer.from(`${login ?? ''}:${token}`).toString('base64')}`;
      } else if (handle.scheme === 'token') {
        headers.authorization = `token ${token}`;
      } else if (handle.scheme === 'bearer') {
        headers.authorization = `Bearer ${token}`;
      }
    }

    try {
      const answer = await fetch(url, {
        method,
        headers,
        body: body.body,
        redirect: 'manual'
      });
      const answerBody = await answer.text();
      const answerHeaders: Record<string, string> = {};
      for (const [key, value] of answer.headers) {
        if (['content-type', 'link', 'etag', 'x-total-count', 'x-total', 'retry-after'].includes(key) || key.startsWith('x-ratelimit-')) {
          answerHeaders[key] = value;
        }
      }
      send(200, { status: answer.status, headers: answerHeaders, body: answerBody });
    } catch (error) {
      send(502, { error: { message: error instanceof Error ? error.message : String(error), code: 'FORGE_UNREACHABLE' } });
    }
  }

  private async ensure(record: GuestRecord): Promise<Runtime> {
    const existing = this.runtimes.get(record.id);
    if (existing) {
      await existing.ready;
      return existing;
    }

    const callbackUrl = await this.ensureCallback();
    const port = await reservePort();
    const token = randomBytes(24).toString('base64url');
    const dataDir = path.join(this.storageRoot.fsPath, 'guest-data', record.id);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });

    const env = allowlistedEnv({
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: token,
      OPENCHAMBER_HOST_CALLBACK_URL: callbackUrl,
      OPENCHAMBER_SERVICE_DATA_DIR: dataDir
    });
    if (process.versions.electron) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    this.output.info(`Starting integration ${record.name} (${record.id}) on 127.0.0.1:${port}`);
    const child = spawn(process.execPath, [record.entry], {
      cwd: record.packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout?.on('data', (chunk: Buffer) => this.output.debug(`[${record.id}] ${chunk.toString().trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => this.output.warn(`[${record.id}] ${chunk.toString().trimEnd()}`));

    const runtime: Runtime = {
      child,
      port,
      token,
      ready: this.waitReady(port, token, child)
    };
    this.runtimes.set(record.id, runtime);
    child.once('exit', (code) => {
      this.output.info(`Integration ${record.name} exited (${code ?? 'signal'})`);
      this.runtimes.delete(record.id);
    });

    try {
      await runtime.ready;
    } catch (error) {
      this.runtimes.delete(record.id);
      child.kill();
      throw error;
    }
    return runtime;
  }

  private async waitReady(port: number, token: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Integration service exited with code ${child.exitCode}`);
      }
      try {
        const answer = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(1_000)
        });
        if (answer.status === 200) {
          return;
        }
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Integration service did not become ready within 15 seconds');
  }
}
