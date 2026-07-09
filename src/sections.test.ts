import { describe, expect, test } from 'bun:test';
import type { Pane } from './api';
import type { Prefs } from './context';
import { buildSummarySections } from './sections';

const PREFS: Prefs = {
  privacyMode: false,
  technicalNames: false,
  sortByActivity: true,
  respondedNewestFirst: true,
  soundAlerts: false,
  showSystemStats: false,
  showClaudeUsage: false,
};

function pane(overrides: Partial<Pane>): Pane {
  return {
    pane_id: '%1',
    target: 'cc-x:1.0',
    window_id: '@1',
    session: 'cc-x',
    project: 'x',
    cwd: '/',
    agent: 'claude',
    status: 'idle',
    attention: false,
    wait_reason: null,
    unseen: true,
    marked_unread: false,
    permission_mode: null,
    pane_active: false,
    age_minutes: 1,
    section: 'idle',
    priority: null,
    prompt: '',
    current_command: '',
    summary: '',
    pane_name: '',
    window_name: '',
    worktree_name: '',
    worktree_branch: '',
    bg_cmd: '',
    ...overrides,
  } as Pane;
}

describe('buildSummarySections', () => {
  test('duplicate pane_id rows collapse to one entry per section', () => {
    const dup = pane({ pane_id: '%350' });
    const sections = buildSummarySections([dup, pane({ pane_id: '%351' }), dup], PREFS);
    const responded = sections.find((s) => s.key === 'responded')!;
    expect(responded.data.map((p) => p.pane_id).sort()).toEqual(['%350', '%351']);
  });
});
