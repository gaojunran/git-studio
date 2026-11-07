import { describe, expect, it } from 'vitest';
import { guestRepoFor, GuestProvider } from './provider';
import type { GuestService } from './service';
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

describe('GuestProvider writes', () => {
  const fullRecord: GuestRecord = {
    ...record,
    descriptor: {
      label: 'Teahouse',
      capabilities: {
        issues: true,
        changeRequests: true,
        comments: true,
        state: true,
        labels: true,
        reviewers: true,
        reviews: true,
        merge: { methods: ['merge'] },
        reviewModel: 'verdict'
      },
      limits: { labelsMax: 100, reviewersMax: 50, commentMaxLength: 1000, reviewerId: 'login' }
    } as unknown as GuestRecord['descriptor']
  };

  const create = () => {
    const mutations: Array<{ kind: string; input: Record<string, unknown>; context: Record<string, unknown>; route: string }> = [];
    const requests: string[] = [];
    const service = {
      request: async (_record: GuestRecord, method: string) => {
        requests.push(method);
        if (method === 'changeRequestContext') {
          return {
            changeRequest: {
              id: '2',
              number: 2,
              title: 'Steep longer',
              url: 'https://gitea.example.com/mona/teapot/pulls/2',
              state: 'open',
              draft: false,
              base: 'main',
              head: 'feature',
              headSha: 'b'.repeat(40),
              reviewers: [{ login: 'mona' }]
            },
            issueComments: []
          };
        }
        if (method === 'listLabels') return [{ name: 'bug', color: 'd73a4a' }];
        if (method === 'listReviewerCandidates') return [{ login: 'mona' }, { login: 'octo' }];
        return [];
      },
      mutate: async (_record: GuestRecord, kind: string, input: Record<string, unknown>, context: Record<string, unknown>, route: string) => {
        mutations.push({ kind, input, context, route });
        return {};
      }
    } as unknown as GuestService;
    const repo = guestRepoFor(fullRecord, 'https://gitea.example.com/mona/teapot.git')!;
    repo.root = '/repo';
    return { provider: new GuestProvider(fullRecord, service, repo), mutations, requests };
  };

  it('exposes write capabilities from the manifest', async () => {
    const { provider } = create();
    const detail = await provider.detail('pull', 2);
    expect(detail.canEditLabels).toBe(true);
    expect(detail.canEditReviewers).toBe(true);
    expect(detail.canReview).toBe(true);
    expect(detail.mergeMethods).toEqual(['merge']);
    expect(detail.headSha).toBe('b'.repeat(40));
    expect(detail.reviewers).toEqual([{ login: 'mona', name: null, avatarUrl: null }]);
  });

  it('sends labels, reviewers and reviews through mutate', async () => {
    const { provider, mutations } = create();
    await provider.setLabels(2, ['bug', 'ads']);
    await provider.setReviewers(2, ['mona']);
    await provider.review(2, 'approve');
    expect(mutations.map((mutation) => ({ kind: mutation.kind, route: mutation.route, input: mutation.input }))).toEqual([
      { kind: 'change-request-labels', route: '/pr/labels', input: { names: ['bug', 'ads'] } },
      { kind: 'change-request-reviewers', route: '/pr/reviewers', input: { names: ['mona'] } },
      { kind: 'change-request-review', route: '/pr/review', input: { verdict: 'approve' } }
    ]);
    expect(mutations[0]?.context).toMatchObject({ repositoryId: '/repo', target: { number: 2 } });
  });

  it('reads label and reviewer candidates', async () => {
    const { provider } = create();
    expect(await provider.listLabels()).toEqual([{ name: 'bug', color: 'd73a4a' }]);
    expect(await provider.listReviewerCandidates()).toEqual([
      { login: 'mona', name: null, avatarUrl: null },
      { login: 'octo', name: null, avatarUrl: null }
    ]);
  });
});
