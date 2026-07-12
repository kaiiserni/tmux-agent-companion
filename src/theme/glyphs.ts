import type { ThemeColors } from './tokens';

// Agent-type glyphs - mirror AgentType in tmux-agent-dashboard/src/tmux/types.rs.
export function agentGlyph(agent: string): string {
  switch (agent) {
    case 'claude':
      return '✦';
    case 'codex':
      return '◉';
    case 'grok':
      return '⬡';
    case 'opencode':
      return '◇';
    case 'antigravity':
      return '▲';
    case 'pi':
      return 'π';
    default:
      return '·';
  }
}

// Full provider name for UI copy (never single-letter keys).
export function agentLabel(agent: string): string {
  switch (agent) {
    case 'claude':
    case 'codex':
    case 'grok':
    case 'opencode':
    case 'antigravity':
    case 'pi':
      return agent;
    default:
      return agent || 'unknown';
  }
}

const ACCOUNT_NAMES: Record<string, string> = {
  g: 'gmail',
  c: 'canarycoders',
  p: 'canarypulse',
  y: 'kyan',
};

export function accountLabel(key: string): string {
  return ACCOUNT_NAMES[key] ?? key;
}

// Model + Claude account line under pane titles; provider is always spelled out.
export function paneProviderMeta(pane: { agent: string; model: string; account: string }): string {
  const parts = [agentLabel(pane.agent)];
  if (pane.model) parts.push(pane.model);
  if (pane.agent === 'claude' && pane.account) parts.push(accountLabel(pane.account));
  return parts.join(' · ');
}

// Status glyphs - mirror StatusIcons::default() in src/ui/icons.rs.
export function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return '●';
    case 'background':
      return '◎';
    case 'waiting':
    case 'notification':
      return '◐';
    case 'idle':
      return '○';
    case 'error':
      return '✕';
    default:
      return '·';
  }
}

export function statusColor(status: string, c: ThemeColors): string {
  switch (status) {
    case 'running':
      return c.running;
    case 'background':
      return c.cyan;
    case 'waiting':
    case 'notification':
      return c.waiting;
    case 'error':
      return c.attention;
    case 'idle':
      return c.muted;
    default:
      return c.dim;
  }
}

// Section markers used by the Summary tab.
export const SECTION_GLYPH = {
  attention: '▲',
  waiting: '◐',
  responded: '↩',
  running: '●',
  marked_unread: '📌',
  idle: '○',
} as const;
