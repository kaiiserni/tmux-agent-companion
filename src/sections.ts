import type { Pane } from './api';
import type { Prefs } from './context';

export type SummaryKey = 'attention' | 'waiting' | 'responded' | 'running' | 'marked_unread' | 'idle';

export const SUMMARY_TITLES: Record<SummaryKey, string> = {
  attention: 'needs attention',
  waiting: 'waiting',
  responded: 'responded',
  running: 'running',
  marked_unread: 'marked unread',
  idle: 'idle',
};

// Mirrors tmux-agent-dashboard `section_of` / `pending::classify`: each pane
// lands in exactly one Summary section; attention outranks status.
export function sectionOf(
  attention: boolean,
  status: string,
  markedUnread: boolean,
  unseen: boolean,
): SummaryKey | null {
  if (attention) return 'attention';
  if (status === 'waiting' || status === 'notification' || status === 'error') return 'waiting';
  if (status === 'running' || status === 'background') return 'running';
  if (status === 'idle') {
    if (unseen) return 'responded';
    if (markedUnread) return 'marked_unread';
    return 'idle';
  }
  return null;
}

function paneSection(p: Pane): SummaryKey | null {
  return sectionOf(p.attention, p.status, p.marked_unread, p.unseen);
}

const byRecency = (a: Pane, b: Pane) => (a.age_minutes ?? 1e9) - (b.age_minutes ?? 1e9);
const byName = (a: Pane, b: Pane) => a.project.localeCompare(b.project);

export function buildSummarySections(panes: Pane[], prefs: Prefs) {
  const order: SummaryKey[] = ['attention', 'waiting', 'responded', 'running', 'marked_unread', 'idle'];
  const sorter = prefs.sortByActivity ? byRecency : byName;
  const buckets = new Map<SummaryKey, Map<string, Pane>>();
  for (const key of order) buckets.set(key, new Map());

  for (const p of panes) {
    const key = paneSection(p);
    if (!key) continue;
    const bucket = buckets.get(key)!;
    if (!bucket.has(p.pane_id)) bucket.set(p.pane_id, p);
  }

  return order
    .map((key) => {
      let data = [...buckets.get(key)!.values()].sort(sorter);
      if (key === 'responded' && !prefs.respondedNewestFirst) data = data.reverse();
      return { key, title: SUMMARY_TITLES[key], data };
    })
    .filter((s) => s.data.length > 0);
}