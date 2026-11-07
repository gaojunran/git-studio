import type * as vscode from 'vscode';
import type { GuestManifest } from './manifest';

export interface GuestRecord {
  id: string;
  name: string;
  packageRoot: string;
  entry: string;
  version: string;
  instance: string;
  descriptor: GuestManifest['descriptor'];
}

const KEY = 'gitStudio.board.guests.v1';

export class GuestStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): GuestRecord[] {
    return this.state.get<GuestRecord[]>(KEY, []);
  }

  async add(record: GuestRecord): Promise<void> {
    const next = this.list().filter((entry) => entry.id !== record.id);
    next.push(record);
    await this.state.update(KEY, next);
  }

  async remove(id: string): Promise<void> {
    await this.state.update(KEY, this.list().filter((entry) => entry.id !== id));
  }

  get(id: string): GuestRecord | undefined {
    return this.list().find((entry) => entry.id === id);
  }
}
