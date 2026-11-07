import { describe, expect, it, vi } from 'vitest';
import type { GuestRecord } from './store';
import type { BoardKind } from '../../../shared/board';
import { GuestProvider } from './provider';

const record = {
  id: 'votes-host',
  name: 'Votes host',
  packageRoot: '/tmp/votes-host',
  entry: 'service/index.js',
  version: '1.0.0',
  instance: 'https://votes.example',
  descriptor: {
    label: 'Votes',
    capabilities: {
      issues: false,
      changeRequests: true,
      reviews: true,
      reviewModel: 'votes'
    }
  }
} as unknown as GuestRecord;

const repo = {
  root: '/tmp/repo',
  owner: 'mona',
  name: 'teapot',
  url: 'https://votes.example/mona/teapot',
  providerId: 'ext-votes-host',
  providerLabel: 'Votes',
  kinds: ['pull'] as BoardKind[]
};

const pull = {
  id: '1',
  number: 7,
  title: 'Steep longer',
  state: 'open',
  draft: false,
  base: 'main',
  head: 'feature',
  url: 'https://votes.example/mona/teapot/changes/7',
  author: { username: 'mona' }
};

describe('GuestProvider votes', () => {
  it('maps vote labels from the change context', async () => {
    const request = vi.fn(async () => ({
      changeRequest: pull,
      issueComments: [],
      voteLabels: [
        {
          name: 'Code-Review',
          values: [{ value: 2, description: 'Looks good' }, { value: 0 }],
          defaultValue: 0,
          permitted: [-1, 0, 1, 2],
          blocking: true,
          status: 'neutral',
          votes: [{ user: { username: 'octo' }, value: 1 }]
        }
      ]
    }));
    const provider = new GuestProvider(record, { request } as never, repo);
    const detail = await provider.detail('pull', 7);
    expect(detail.reviewModel).toBe('votes');
    expect(detail.voteLabels).toEqual([
      {
        name: 'Code-Review',
        values: [{ value: 2, description: 'Looks good' }, { value: 0, description: null }],
        defaultValue: 0,
        permitted: [-1, 0, 1, 2],
        blocking: true,
        status: 'neutral',
        votes: [{ user: { login: 'octo', name: null, avatarUrl: null }, value: 1 }]
      }
    ]);
  });

  it('sends votes to /pr/review instead of a verdict', async () => {
    const mutate = vi.fn(async () => undefined);
    const provider = new GuestProvider(record, { mutate } as never, repo);
    await provider.reviewVotes(7, { 'Code-Review': 2 });
    expect(mutate).toHaveBeenCalledWith(
      record,
      'change-request-review',
      { votes: { 'Code-Review': 2 } },
      expect.objectContaining({ target: { number: 7 } }),
      '/pr/review'
    );
  });
});
