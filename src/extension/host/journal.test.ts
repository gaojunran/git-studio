import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { Journal } from './journal';

class FakeMemento {
  private store: unknown;

  get<T>(_key: string): T | undefined {
    return this.store as T | undefined;
  }

  async update(_key: string, value: unknown): Promise<void> {
    this.store = value;
  }
}

describe('Journal', () => {
  it('records, returns the last entry and pops', async () => {
    const journal = new Journal(new FakeMemento() as unknown as vscode.Memento);
    await journal.record('/repo', { label: 'revert a', before: '1', after: '2', branch: 'main', at: 1 });
    await journal.record('/repo', { label: 'reset', before: '2', after: '3', branch: 'main', at: 2 });

    expect(journal.last('/repo')?.label).toBe('reset');
    expect(journal.list('/repo')).toHaveLength(2);

    await journal.pop('/repo');
    expect(journal.last('/repo')?.label).toBe('revert a');
    expect(journal.list('/other')).toEqual([]);
  });

  it('caps the history at 20 entries', async () => {
    const journal = new Journal(new FakeMemento() as unknown as vscode.Memento);
    for (let index = 0; index < 25; index += 1) {
      await journal.record('/repo', { label: `op ${index}`, before: 'a', after: 'b', branch: null, at: index });
    }
    expect(journal.list('/repo')).toHaveLength(20);
    expect(journal.last('/repo')?.label).toBe('op 24');
  });
});
