import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { readGuestManifest } from './guest/manifest';
import type { GuestRecord } from './guest/store';
import type { BoardContext } from './service';
import { BoardPanel } from './panel';

const execFileAsync = promisify(execFile);

function instanceAllowed(raw: string, descriptor: GuestRecord['descriptor']): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Enter a full URL, such as https://gitea.example.com');
  }
  if (url.protocol !== 'https:' && !(descriptor.instances.allowLoopbackHttp && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
    throw new Error('The instance must use https (http is allowed only on loopback).');
  }
  if (url.port && !descriptor.instances.allowPort) {
    throw new Error('This integration does not allow a port in the instance address.');
  }
  return url.origin;
}

async function pickInstance(descriptor: GuestRecord['descriptor']): Promise<string | undefined> {
  const defaults = descriptor.instances.defaultInstances;
  if (defaults.length === 1) {
    return defaults[0];
  }
  if (defaults.length > 1) {
    const picked = await vscode.window.showQuickPick(defaults, { placeHolder: `Choose the ${descriptor.label} instance` });
    return picked;
  }
  if (!descriptor.instances.custom) {
    throw new Error('This integration declares no instance to connect to.');
  }
  return vscode.window.showInputBox({
    title: `${descriptor.label} instance`,
    prompt: 'The base URL of your server, for example https://gitea.example.com',
    placeHolder: descriptor.instances.placeholder,
    ignoreFocusOut: true
  });
}

export async function installIntegration(board: BoardContext, options: { folder?: string; instance?: string; token?: string; login?: string } = {}): Promise<void> {
  const picked = options.folder
    ? [vscode.Uri.file(options.folder)]
    : await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Install integration'
    });
  const folder = picked?.[0];
  if (!folder) {
    return;
  }

  try {
    const manifest = await readGuestManifest(folder.fsPath);
    const instance = options.instance ?? await pickInstance(manifest.descriptor);
    if (!instance) {
      return;
    }
    const record: GuestRecord = {
      id: manifest.id,
      name: manifest.name,
      packageRoot: manifest.packageRoot,
      entry: manifest.entry,
      version: manifest.version,
      instance: instanceAllowed(instance, manifest.descriptor),
      descriptor: manifest.descriptor,
      source: { kind: 'folder' }
    };
    await board.guests.add(record);
    if (options.token) {
      await board.guestService.connect(record, options.token, options.login);
      void vscode.window.showInformationMessage(`Git Studio: installed and connected ${manifest.name}.`);
    } else {
      const connect = await vscode.window.showInformationMessage(
        `Git Studio: installed ${manifest.name}. Connect an account now?`,
        'Connect',
        'Later'
      );
      if (connect === 'Connect') {
        await connectIntegration(board);
      }
    }
    await BoardPanel.refreshCurrent();
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function installIntegrationFromGit(
  board: BoardContext,
  options: { url?: string; instance?: string; token?: string; login?: string } = {}
): Promise<void> {
  const url = options.url ?? await vscode.window.showInputBox({
    title: 'Install integration from Git',
    prompt: 'HTTPS or SSH URL of a repository containing an OpenChamber integration package.',
    placeHolder: 'https://github.com/owner/openchamber-integration',
    ignoreFocusOut: true
  });
  if (!url) {
    return;
  }

  const hash = createHash('sha1').update(url).digest('hex').slice(0, 12);
  const target = path.join(board.storage.fsPath, 'guests', hash);
  try {
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', url, target], {
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    const manifest = await readGuestManifest(target);
    const instance = options.instance ?? await pickInstance(manifest.descriptor);
    if (!instance) {
      return;
    }
    const record: GuestRecord = {
      id: manifest.id,
      name: manifest.name,
      packageRoot: manifest.packageRoot,
      entry: manifest.entry,
      version: manifest.version,
      instance: instanceAllowed(instance, manifest.descriptor),
      descriptor: manifest.descriptor,
      source: { kind: 'git', url }
    };
    await board.guests.add(record);
    if (options.token) {
      await board.guestService.connect(record, options.token, options.login);
      void vscode.window.showInformationMessage(`Git Studio: installed and connected ${manifest.name}.`);
    } else {
      const connect = await vscode.window.showInformationMessage(
        `Git Studio: installed ${manifest.name}. Connect an account now?`,
        'Connect',
        'Later'
      );
      if (connect === 'Connect') {
        await connectIntegration(board);
      }
    }
    await BoardPanel.refreshCurrent();
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function installIntegrationFromArchive(board: BoardContext, options: { archive?: string; instance?: string; token?: string; login?: string } = {}): Promise<void> {
  const picked = options.archive
    ? [vscode.Uri.file(options.archive)]
    : await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectFiles: true,
      canSelectMany: false,
      filters: { Archives: ['zip', 'vsix'] },
      openLabel: 'Install integration'
    });
  const archive = picked?.[0];
  if (!archive) {
    return;
  }

  const hash = createHash('sha1').update(archive.fsPath).digest('hex').slice(0, 12);
  const target = path.join(board.storage.fsPath, 'guests', hash);
  try {
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true, mode: 0o700 });
    await execFileAsync('unzip', ['-q', archive.fsPath, '-d', target], { timeout: 120_000 });
    let manifest: Awaited<ReturnType<typeof readGuestManifest>> | undefined;
    let manifestError: unknown;
    for (const root of [target, path.join(target, 'extension')]) {
      try {
        manifest = await readGuestManifest(root);
        break;
      } catch (error) {
        manifestError = error;
      }
    }
    if (!manifest) {
      throw manifestError;
    }
    const instance = options.instance ?? await pickInstance(manifest.descriptor);
    if (!instance) {
      return;
    }
    const record: GuestRecord = {
      id: manifest.id,
      name: manifest.name,
      packageRoot: manifest.packageRoot,
      entry: manifest.entry,
      version: manifest.version,
      instance: instanceAllowed(instance, manifest.descriptor),
      descriptor: manifest.descriptor,
      source: { kind: 'archive', url: archive.fsPath }
    };
    await board.guests.add(record);
    if (options.token) {
      await board.guestService.connect(record, options.token, options.login);
      void vscode.window.showInformationMessage(`Git Studio: installed and connected ${manifest.name}.`);
    } else {
      const connect = await vscode.window.showInformationMessage(
        `Git Studio: installed ${manifest.name}. Connect an account now?`,
        'Connect',
        'Later'
      );
      if (connect === 'Connect') {
        await connectIntegration(board);
      }
    }
    await BoardPanel.refreshCurrent();
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updateIntegration(board: BoardContext): Promise<void> {
  const guests = board.guests.list().filter((guest) => guest.source?.kind === 'git');
  if (guests.length === 0) {
    void vscode.window.showInformationMessage('Git Studio: no Git-installed integration to update.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    guests.map((guest) => ({ label: guest.name, description: guest.source?.url ?? guest.instance, guest })),
    { placeHolder: 'Update an integration' }
  );
  if (!picked) {
    return;
  }
  try {
    await execFileAsync('git', ['-C', picked.guest.packageRoot, 'pull', '--ff-only'], {
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    const manifest = await readGuestManifest(picked.guest.packageRoot);
    if (manifest.id !== picked.guest.id) {
      throw new Error(`The package id changed from ${picked.guest.id} to ${manifest.id}; remove and reinstall it.`);
    }
    const record: GuestRecord = {
      ...picked.guest,
      name: manifest.name,
      entry: manifest.entry,
      version: manifest.version,
      descriptor: manifest.descriptor
    };
    await board.guests.add(record);
    await board.guestService.stop(record.id);
    void vscode.window.showInformationMessage(`Git Studio: updated ${manifest.name} to ${manifest.version}.`);
    await BoardPanel.refreshCurrent();
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function connectIntegration(board: BoardContext): Promise<void> {
  const guests = board.guests.list();
  if (guests.length === 0) {
    void vscode.window.showWarningMessage('Git Studio: no integration is installed. Run "Install Integration Extension" first.');
    return;
  }
  const picked = guests.length === 1
    ? guests[0]
    : (await vscode.window.showQuickPick(
      guests.map((guest) => ({ label: guest.name, description: guest.instance, guest })),
      { placeHolder: 'Connect an integration account' }
    ))?.guest;
  if (!picked) {
    return;
  }

  const token = await vscode.window.showInputBox({
    title: `${picked.descriptor.label} token`,
    prompt: `Token for ${picked.instance}. Stored in VS Code SecretStorage.`,
    password: true,
    ignoreFocusOut: true
  });
  if (!token) {
    return;
  }
  let login: string | undefined;
  if (picked.descriptor.token.username) {
    login = await vscode.window.showInputBox({
      title: `${picked.descriptor.label} username`,
      prompt: 'The username sent with the token (HTTP Basic).',
      ignoreFocusOut: true
    });
    if (!login) {
      return;
    }
  }

  try {
    await board.guestService.connect(picked, token, login);
    void vscode.window.showInformationMessage(`Git Studio: connected ${picked.descriptor.label}.`);
    await BoardPanel.refreshCurrent();
  } catch (error) {
    void vscode.window.showErrorMessage(`Git Studio: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function removeIntegration(board: BoardContext): Promise<void> {
  const guests = board.guests.list();
  if (guests.length === 0) {
    void vscode.window.showInformationMessage('Git Studio: no integration is installed.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    guests.map((guest) => ({ label: guest.name, description: guest.instance, guest })),
    { placeHolder: 'Remove an integration' }
  );
  if (!picked) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Remove ${picked.guest.name}? Its token is forgotten; the package folder stays.`,
    { modal: true },
    'Remove'
  );
  if (confirmed !== 'Remove') {
    return;
  }
  await board.guestService.disconnect(picked.guest);
  await board.guests.remove(picked.guest.id);
  await BoardPanel.refreshCurrent();
}
