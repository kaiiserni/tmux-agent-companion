import { statSync } from "node:fs";

// Per-pane activity log written by the tmux-agent-dashboard hooks. Its mtime is
// the agent's real "last did something" signal.
export function activityLogPath(paneId: string): string {
  return `/tmp/tmux-agent-activity_${paneId.replace("%", "")}.log`;
}

export function activityMtime(paneId: string): number {
  try {
    return Math.floor(statSync(activityLogPath(paneId)).mtimeMs / 1000);
  } catch {
    return 0;
  }
}

// Friendly project name from a working directory (handles bare-repo worktrees:
// `foo.git/main` → `foo`).
export function projectName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const seg = trimmed.split("/").pop() || trimmed;
  return seg === "main" || seg === "master"
    ? trimmed.split("/").slice(-2, -1)[0]?.replace(/\.git$/, "") || seg
    : seg.replace(/\.git$/, "");
}
