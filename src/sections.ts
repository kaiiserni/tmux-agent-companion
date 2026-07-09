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

const isWaiting = (s: string) => s === 'waiting' || s === 'notification' || s === 'error';
const isRunning = (s: string) => s === 'running' || s === 'background';
const isIdle = (s: string) => s === 'idle' || s === 'unknown';

// Dashboard Summary section filters (src/ui/dashboard.rs) - non-exclusive:
// a pane can appear in both Attention and Waiting.
function inSection(p: Pane, key: SummaryKey): boolean {
  switch (key) {
    case 'attention':
      return p.attention;
    case 'waiting':
      return isWaiting(p.status);
    case 'running':
      return isRunning(p.status);
    case 'responded':
      return isIdle(p.status) && p.unseen;
    case 'marked_unread':
      return isIdle(p.status) && !p.attention && p.marked_unread && !p.unseen;
    case 'idle':
      return isIdle(p.status) && !p.unseen && !p.marked_unread;
  }
}

const byRecency = (a: Pane, b: Pane) => (a.age_minutes ?? 1e9) - (b.age_minutes ?? 1e9);
const byName = (a: Pane, b: Pane) => a.project.localeCompare(b.project);

export function buildSummarySections(panes: Pane[], prefs: Prefs) {
  const order: SummaryKey[] = ['attention', 'waiting', 'responded', 'running', 'marked_unread', 'idle'];
  const sorter = prefs.sortByActivity ? byRecency : byName;
  return order
    .map((key) => {
      // Dedupe by pane_id: the bridge should never send duplicates, but a stray
      // duplicate row would crash the SectionList key invariant.
      let data = [...new Map(panes.filter((p) => inSection(p, key)).map((p) => [p.pane_id, p])).values()].sort(sorter);
      if (key === 'responded' && !prefs.respondedNewestFirst) data = data.reverse();
      return { key, title: SUMMARY_TITLES[key], data };
    })
    .filter((s) => s.data.length > 0);
}
