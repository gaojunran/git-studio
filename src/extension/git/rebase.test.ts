import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RebasePlan } from '../../shared/protocol';
import { buildTodo, shellQuote, validatePlan } from './rebase';

const dirs: string[] = [];

function plan(actions: RebasePlan['items']): RebasePlan {
  return {
    head: 'head',
    target: 'target',
    targetShort: 'target',
    branch: 'main',
    items: actions
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('validatePlan', () => {
  it('rejects empty plans and leading squash', () => {
    expect(validatePlan(plan([{ hash: 'a', shortHash: 'a', subject: 'a', action: 'drop' }]))).toBe('Keep at least one commit.');
    expect(
      validatePlan(
        plan([
          { hash: 'a', shortHash: 'a', subject: 'a', action: 'squash' },
          { hash: 'b', shortHash: 'b', subject: 'b', action: 'pick' }
        ])
      )
    ).toBe('The first kept commit cannot be squashed or fixed up.');
  });

  it('requires reword messages', () => {
    expect(
      validatePlan(plan([{ hash: 'a', shortHash: 'a', subject: 'a', action: 'reword', message: '  ' }]))
    ).toBe('Every reword needs a message.');
  });

  it('accepts a normal plan', () => {
    expect(
      validatePlan(
        plan([
          { hash: 'a', shortHash: 'a', subject: 'a', action: 'pick' },
          { hash: 'b', shortHash: 'b', subject: 'b', action: 'squash' },
          { hash: 'c', shortHash: 'c', subject: 'c', action: 'drop' }
        ])
      )
    ).toBeUndefined();
  });
});

describe('buildTodo', () => {
  it('writes actions, reword exec lines and message files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gitstudio-todo-'));
    dirs.push(dir);

    const todo = buildTodo(
      plan([
        { hash: 'aaa', shortHash: 'aaa', subject: 'one', action: 'pick' },
        { hash: 'bbb', shortHash: 'bbb', subject: 'two', action: 'reword', message: "two's message" },
        { hash: 'ccc', shortHash: 'ccc', subject: 'three', action: 'edit' },
        { hash: 'ddd', shortHash: 'ddd', subject: 'four', action: 'fixup' },
        { hash: 'eee', shortHash: 'eee', subject: 'five', action: 'drop' }
      ]),
      dir
    );

    expect(todo).toContain('pick aaa');
    expect(todo).toContain('pick bbb');
    expect(todo).toContain("exec git commit --amend -F '");
    expect(todo).toContain('edit ccc');
    expect(todo).toContain('fixup ddd');
    expect(todo).not.toContain('eee');
    expect(readFileSync(path.join(dir, 'bbb.msg'), 'utf8')).toBe("two's message\n");
  });
});

describe('shellQuote', () => {
  it('escapes single quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});
