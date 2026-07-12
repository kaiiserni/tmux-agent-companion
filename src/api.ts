import { getToken } from './config';

export interface Pane {
  pane_id: string;
  target: string;
  window_id: string;
  session: string;
  project: string;
  cwd: string;
  agent: string;
  model: string;
  account: string;
  status: string;
  attention: boolean;
  wait_reason: string | null;
  unseen: boolean;
  marked_unread: boolean;
  permission_mode: string | null;
  pane_active: boolean;
  age_minutes: number | null;
  section: 'attention' | 'running' | 'idle';
  priority: number | null;
  prompt: string;
  current_command: string;
  summary: string;
  pane_name: string;
  window_name: string;
  worktree_name: string;
  worktree_branch: string;
  bg_cmd: string;
  started_at: number;
  last_seen_at: number;
  activity_at: number;
  doing: string;
  needs_from_you: string | null;
  next_steps: string[];
}

export interface Counts {
  all: number;
  running: number;
  background: number;
  waiting: number;
  idle: number;
  error: number;
  attention: number;
}

export interface PanesResponse {
  updated_at: number;
  tmux: boolean;
  counts: Counts;
  panes: Pane[];
}

export interface ActivityEntry {
  time: string;
  tool: string;
  label: string;
  pane?: string;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'tool_use';
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  ts?: string;
}

export interface Transcript {
  pane_id: string;
  session_id: string;
  found: boolean;
  entries: TranscriptEntry[];
}

export interface OverviewFull {
  updated_at: number;
  tldr: string[];
  projects: {
    name: string;
    attention: boolean;
    doing: string;
    needs_from_you: string | null;
    next_steps: string[];
    active_md: string[];
    idle_minutes?: number | null;
    panes: { pane_id: string; target: string; agent: string; status: string; age_minutes: number | null; summary: string }[];
  }[];
  idle: { pane_id: string; target: string; project: string; task: string }[];
}

// Every bridge route except /health is token-gated, so all calls carry the token.
async function get<T>(baseUrl: string, path: string): Promise<T> {
  if (!baseUrl) throw new Error('No bridge URL set');
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// LLM output sometimes emits the literal string "null" for an absent blocker.
const cleanBlocker = (v: string | null | undefined): string | null => (v && v !== 'null' ? v : null);

async function post(baseUrl: string, path: string, body: unknown): Promise<void> {
  if (!baseUrl) throw new Error('No bridge URL set');
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
}

export async function getPanes(b: string): Promise<PanesResponse> {
  const r = await get<PanesResponse>(b, '/panes');
  for (const p of r.panes) p.needs_from_you = cleanBlocker(p.needs_from_you);
  return r;
}
export async function getOverviewFull(b: string): Promise<OverviewFull> {
  const r = await get<OverviewFull>(b, '/overview/full');
  for (const p of r.projects) p.needs_from_you = cleanBlocker(p.needs_from_you);
  return r;
}
export const getRecentActivity = (b: string, limit = 200) =>
  get<{ activity: ActivityEntry[] }>(b, `/activity/recent?limit=${limit}`);
export const getActivity = (b: string, paneId: string) =>
  get<{ activity: ActivityEntry[] }>(b, `/activity?pane_id=${encodeURIComponent(paneId)}`);
export const getTranscript = (b: string, paneId: string, limit = 40) =>
  get<Transcript>(b, `/transcript?pane_id=${encodeURIComponent(paneId)}&limit=${limit}`);
export const getScreen = (b: string, paneId: string) =>
  get<{ pane_id: string; text: string }>(b, `/screen?pane_id=${encodeURIComponent(paneId)}`);

export interface SystemStats {
  cpu: number;
  mem: { used: number; total: number; percent: number };
  load: number[];
}
export interface UsageLimit {
  kind: string;
  group: string;
  percent: number | null;
  severity: string;
  resets_at: string | null;
  model: string | null;
}
// One entry per Claude account; `key` matches a pane's `account` (g/c/p).
export interface UsageAccount {
  key: string;
  name: string;
  updated_at: number;
  plan: string | null;
  session: UsageLimit | null;
  weekly: UsageLimit | null;
  weekly_scoped: UsageLimit | null;
  limits: UsageLimit[];
}
export interface ClaudeUsage {
  updated_at: number;
  accounts: UsageAccount[];
}
export const getSystem = (b: string) => get<SystemStats>(b, '/system');
export const getClaudeUsage = (b: string) => get<ClaudeUsage>(b, '/claude-usage');

export interface PromptState {
  pane_id: string;
  agent: string;
  status: string;
  wait_reason: string | null;
  waiting: boolean;
  options: { num: number; label: string; description?: string }[];
  screen: string;
}

export const getPrompt = (b: string, paneId: string) =>
  get<PromptState>(b, `/prompt?pane_id=${encodeURIComponent(paneId)}`);
export const postSend = (b: string, paneId: string, text: string) => post(b, '/send', { pane_id: paneId, text });
export const postAnswer = (b: string, paneId: string, key: string) => post(b, '/answer', { pane_id: paneId, key });

export const postSeen = (b: string, paneId: string) => post(b, '/seen', { pane_id: paneId });
export const postMarkUnread = (b: string, paneId: string, on: boolean) =>
  post(b, '/mark-unread', { pane_id: paneId, on });
export const postClear = (b: string, paneId: string) => post(b, '/clear', { pane_id: paneId });
export const postGoto = (b: string, paneId: string) => post(b, '/goto', { pane_id: paneId });
