import type * as vscode from 'vscode';

export interface JournalEntry {
  label: string;
  before: string;
  after: string;
  branch: string | null;
  at: number;
}

type Store = Record<string, JournalEntry[]>;

const KEY = 'gitStudio.journal';
const LIMIT = 20;

export class Journal {
  constructor(private readonly memento: vscode.Memento) {}

  list(root: string): JournalEntry[] {
    return this.memento.get<Store>(KEY)?.[root] ?? [];
  }

  last(root: string): JournalEntry | undefined {
    const entries = this.list(root);
    return entries[entries.length - 1];
  }

  async record(root: string, entry: JournalEntry): Promise<void> {
    const store = { ...(this.memento.get<Store>(KEY) ?? {}) };
    store[root] = [...(store[root] ?? []), entry].slice(-LIMIT);
    await this.memento.update(KEY, store);
  }

  async pop(root: string): Promise<void> {
    const store = { ...(this.memento.get<Store>(KEY) ?? {}) };
    const entries = store[root] ?? [];
    if (entries.length === 0) {
      return;
    }
    store[root] = entries.slice(0, -1);
    await this.memento.update(KEY, store);
  }
}
