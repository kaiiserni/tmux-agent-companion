// Subset of the agent-overview overview.json schema the bridge enriches panes
// with. The file is optional - the bridge works without it.
export interface OverviewProject {
  name: string;
  attention: boolean;
  doing: string;
  needs_from_you: string | null;
  next_steps: string[];
  active_md: string[];
  panes: { pane_id: string; target: string; agent: string; status: string; age_minutes: number | null; summary: string }[];
}

export interface Overview {
  updated_at: number;
  tldr: string[];
  projects: OverviewProject[];
  idle: { pane_id: string; target: string; project: string; task: string }[];
}
