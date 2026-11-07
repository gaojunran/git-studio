import type * as vscode from 'vscode';
import type { SourceControlContribution, TrackerContribution } from '@openchamber/sdk';

export type GuestRole = 'source-control' | 'tracker';

export interface GuestBase {
  id: string;
  name: string;
  packageRoot: string;
  entry: string;
  version: string;
  instance: string;
  source?: { kind: 'folder' | 'git' | 'archive'; url?: string };
}

export interface SourceControlGuestRecord extends GuestBase {
  role: 'source-control';
  descriptor: SourceControlContribution;
}

export interface TrackerGuestRecord extends GuestBase {
  role: 'tracker';
  tracker: TrackerContribution;
}

export type GuestRecord = SourceControlGuestRecord | TrackerGuestRecord;

const KEY = 'gitStudio.board.guests.v1';

type LegacyRecord = GuestBase & { descriptor?: SourceControlContribution; tracker?: TrackerContribution; role?: GuestRole };

function normalize(record: GuestRecord | LegacyRecord): GuestRecord | undefined {
  const role = record.role;
  if (role === 'source-control') {
    return record as SourceControlGuestRecord;
  }
  if (role === 'tracker') {
    return record as TrackerGuestRecord;
  }
  if (record.tracker) {
    return { ...record, role: 'tracker', tracker: record.tracker };
  }
  if (record.descriptor) {
    return { ...record, role: 'source-control', descriptor: record.descriptor };
  }
  return undefined;
}

export class GuestStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): GuestRecord[] {
    return this.state.get<GuestRecord[]>(KEY, []).flatMap((record) => {
      const normalized = normalize(record);
      return normalized ? [normalized] : [];
    });
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
