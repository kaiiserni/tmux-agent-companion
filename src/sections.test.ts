import { describe, expect, test } from 'bun:test';
import type { Pane } from './api';
import type { Prefs } from './context';
import { buildSummarySections, sectionOf } from './sections';

const PREFS: Prefs = {
  privacyMode: false,
  technicalNames: false,
  sortByActivity: true,
  respondedNewestFirst: true,
  soundAlerts: false,
  showSystemStats: false,
  showClaudeUsage: false,
  faceIdLock: false,
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

describe('sectionOf', () => {
  test('attention wins over status so no pane lands in two sections', () => {
    expect(sectionOf(true, 'waiting', false, false)).toBe('attention');
    expect(sectionOf(true, 'idle', false, true)).toBe('attention');
    expect(sectionOf(true, 'running', false, false)).toBe('attention');
  });

  test('status sections without attention', () => {
    expect(sectionOf(false, 'waiting', false, false)).toBe('waiting');
    expect(sectionOf(false, 'error', false, false)).toBe('waiting');
    expect(sectionOf(false, 'background', false, false)).toBe('running');
    expect(sectionOf(false, 'idle', false, true)).toBe('responded');
    expect(sectionOf(false, 'idle', true, false)).toBe('marked_unread');
    expect(sectionOf(false, 'idle', false, false)).toBe('idle');
    expect(sectionOf(false, 'unknown', false, false)).toBeNull();
  });

  test('unseen idle outranks a pin', () => {
    expect(sectionOf(false, 'idle', true, true)).toBe('responded');
  });
});

describe('buildSummarySections', () => {
  test('duplicate pane_id rows collapse to one entry per section', () => {
    const dup = pane({ pane_id: '%350' });
    const sections = buildSummarySections([dup, pane({ pane_id: '%351' }), dup], PREFS);
    const responded = sections.find((s) => s.key === 'responded')!;
    expect(responded.data.map((p) => p.pane_id).sort()).toEqual(['%350', '%351']);
  });

  test('attention + waiting pane appears only in needs attention', () => {
    const overlap = pane({ pane_id: '%301', attention: true, status: 'waiting' });
    const sections = buildSummarySections([overlap], PREFS);
    expect(sections.map((s) => s.key)).toEqual(['attention']);
    expect(sections[0]!.data[0]!.pane_id).toBe('%301');
  });
});