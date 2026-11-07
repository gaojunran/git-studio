import { describe, expect, it } from 'vitest';
import { guestRepoFor } from './provider';
import type { GuestRecord } from './store';

const descriptor = {
  label: 'Teahouse',
  capabilities: { issues: true, changeRequests: true }
} as GuestRecord['descriptor'];

const record: GuestRecord = {
  id: 'source-control-provider',
  name: 'Teahouse Git host',
  packageRoot: '/tmp/teahouse',
  entry: '/tmp/teahouse/service/main.js',
  version: '1.0.0',
  instance: 'https://gitea.example.com',
  descriptor
};

describe('guestRepoFor', () => {
  it('maps an https remote on the instance host', () => {
    expect(guestRepoFor(record, 'https://gitea.example.com/mona/teapot.git')).toEqual({
      root: '',
      owner: 'mona',
      name: 'teapot',
      url: 'https://gitea.example.com/mona/teapot',
      providerId: 'ext-source-control-provider',
      providerLabel: 'Teahouse',
      kinds: ['issue', 'pull']
    });
  });

  it('maps an ssh remote on the same host', () => {
    expect(guestRepoFor(record, 'git@gitea.example.com:mona/teapot.git')?.name).toBe('teapot');
  });

  it('keeps a nested namespace', () => {
    expect(guestRepoFor(record, 'https://gitea.example.com/team/sub/teapot')?.owner).toBe('team/sub');
  });

  it('ignores a remote on another host', () => {
    expect(guestRepoFor(record, 'https://github.com/mona/teapot.git')).toBeUndefined();
  });

  it('only exposes the kinds the descriptor declares', () => {
    const issuesOnly = { ...record, descriptor: { ...descriptor, capabilities: { issues: true, changeRequests: false } } as GuestRecord['descriptor'] };
    expect(guestRepoFor(issuesOnly, 'https://gitea.example.com/mona/teapot')?.kinds).toEqual(['issue']);
  });
});
