import { timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { activityLogPath, activityMtime, projectName } from "./lib";
import type { Overview, OverviewProject } from "./types";

// Read/write bridge between the live tmux fleet and the companion app. Mirrors the
// dashboard's data + actions so the app can reach 1:1 parity, plus reads Claude Code
// session transcripts so a pane's conversation is viewable from the phone.
// Reachable only over LAN/WireGuard. Read endpoints are open; mutating + transcript/
// screen endpoints require a bearer token (keystroke-free but still fleet-controlling).

const BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT ?? "8790");
const OVERVIEW_JSON = join(homedir(), ".local/state/agent-overview/overview.json");
const PROJECTS_DIR = join(homedir(), ".claude/projects");
const TOKEN_FILE = join(homedir(), ".config/agent-bridge/token");

// --- auth --------------------------------------------------------------------

function loadToken(): string {
  if (process.env.AGENT_BRIDGE_TOKEN) return process.env.AGENT_BRIDGE_TOKEN.trim();
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
const TOKEN = loadToken();

const AUDIT_LOG = join(homedir(), ".local/state/agent-bridge/audit.log");
// Append-only trail of every fleet-mutating request (keystroke injections included).
function audit(action: string, paneId: string, extra = "") {
  try {
    mkdirSync(dirname(AUDIT_LOG), { recursive: true });
    appendFileSync(AUDIT_LOG, `${new Date().toISOString()}\t${action}\t${paneId}\t${extra}\n`);
  } catch {
    /* best-effort */
  }
}

function authOk(req: Request): boolean {
  if (!TOKEN) return false; // no token configured → deny protected routes
  const header = req.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- tmux --------------------------------------------------------------------

function tmux(args: string[]): { ok: boolean; out: string } {
  // Without a UTF-8 locale (launchd!) tmux renders tabs/unicode as "_", breaking
  // the field separator - same guard as collect.ts.
  const proc = Bun.spawnSync(["tmux", ...args], {
    env: { ...process.env, LANG: process.env.LANG ?? "en_US.UTF-8" },
  });
  return { ok: proc.exitCode === 0, out: proc.stdout.toString() };
}

function paneOption(paneId: string, key: string): string {
  const { ok, out } = tmux(["show-options", "-p", "-v", "-t", paneId, key]);
  return ok ? out.replace(/\n+$/, "") : "";
}

const SEP = "\t";
// Only newline/tab-free fields go in the batch line; free text (@pane_prompt,
// @pane_summary) is fetched per-pane so an embedded newline can't split a row.
const LIST_FORMAT = [
  "#{pane_id}",
  "#{session_name}",
  "#{window_index}",
  "#{pane_index}",
  "#{window_id}",
  "#{pane_active}",
  "#{@pane_agent}",
  "#{@pane_status}",
  "#{@pane_attention}",
  "#{@pane_wait_reason}",
  "#{@pane_cwd}",
  "#{@pane_last_seen_at}",
  "#{@pane_started_at}",
  "#{@pane_permission_mode}",
  "#{@dashboard_marked_unread_at}",
  "#{@pane_worktree_name}",
  "#{@pane_worktree_branch}",
  "#{@pane_session_id}",
  "#{@pane_name}",
  "#{window_name}",
  "#{@pane_bg_cmd}",
  "#{pane_current_command}",
].join(SEP);

interface LivePane {
  paneId: string;
  target: string;
  windowId: string;
  session: string;
  paneActive: boolean;
  agent: string;
  status: string;
  attention: boolean;
  waitReason: string;
  cwd: string;
  lastSeenAt: number;
  startedAt: number;
  permissionMode: string;
  markedUnreadAt: number;
  worktreeName: string;
  worktreeBranch: string;
  sessionId: string;
  paneName: string;
  windowName: string;
  bgCmd: string;
  currentCommand: string;
  prompt: string;
  summary: string;
  activityAt: number;
}

function parseLivePaneLine(line: string): LivePane | null {
  const p = line.split(SEP);
  if (p.length < 22) return null;
  const [paneId, session = "", win = "", pane = "", windowId = "", paneActive = "",
    agent = "", status = "", attention = "", waitReason = "", cwd = "", lastSeen = "",
    started = "", permMode = "", markedUnread = "", wtName = "", wtBranch = "",
    sessionId = "", paneName = "", windowName = "", bgCmd = "", currentCommand = ""] = p;
  if (!agent || !paneId) return null;
  return {
    paneId,
    target: `${session}:${win}.${pane}`,
    windowId,
    session,
    paneActive: paneActive === "1",
    agent,
    status: status || "unknown",
    attention: !!attention,
    waitReason: waitReason ?? "",
    cwd: cwd ?? "",
    lastSeenAt: Number(lastSeen) || 0,
    startedAt: Number(started) || 0,
    permissionMode: permMode ?? "",
    markedUnreadAt: Number(markedUnread) || 0,
    worktreeName: wtName ?? "",
    worktreeBranch: wtBranch ?? "",
    sessionId: sessionId ?? "",
    paneName: paneName ?? "",
    windowName: windowName ?? "",
    bgCmd: bgCmd ?? "",
    currentCommand: currentCommand ?? "",
    prompt: paneOption(paneId, "@pane_prompt"),
    summary: paneOption(paneId, "@pane_summary"),
    activityAt: activityMtime(paneId),
  };
}

function collectLive(): LivePane[] | null {
  const { ok, out } = tmux(["list-panes", "-a", "-F", LIST_FORMAT]);
  if (!ok) return null; // no tmux server
  const panes: LivePane[] = [];
  for (const line of out.trimEnd().split("\n")) {
    if (!line) continue;
    const pane = parseLivePaneLine(line);
    if (pane) panes.push(pane);
  }
  return panes;
}

// O(1) single-pane lookup - validates a pane id without scanning the whole fleet.
function collectOne(paneId: string): LivePane | null {
  if (!/^%[0-9]+$/.test(paneId)) return null;
  const { ok, out } = tmux(["display-message", "-p", "-t", paneId, "-F", LIST_FORMAT]);
  if (!ok) return null;
  return parseLivePaneLine(out.replace(/\n+$/, ""));
}

// --- classification (port of pending.rs) -------------------------------------

const PERMISSION_REASONS = new Set([
  "permission",
  "permission_prompt",
  "permission_denied",
  "elicitation_dialog",
]);

function isWaiting(status: string): boolean {
  return status === "waiting" || status === "notification";
}
function isRunning(status: string): boolean {
  return status === "running" || status === "background";
}
function isUnseen(p: LivePane): boolean {
  if (p.activityAt === 0) return false;
  return p.lastSeenAt === 0 || p.activityAt > p.lastSeenAt;
}

// Coarse 3-way section for simple consumers; the app computes the dashboard's
// 6 Summary sections itself from the raw fields below.
function coarseSection(p: LivePane): "attention" | "running" | "idle" {
  if (
    PERMISSION_REASONS.has(p.waitReason) ||
    p.attention ||
    p.status === "error" ||
    isWaiting(p.status) ||
    (!isRunning(p.status) && isUnseen(p))
  ) {
    return "attention";
  }
  return isRunning(p.status) ? "running" : "idle";
}

// Lower = more urgent (pending.rs order). null = not pending.
function priorityRank(p: LivePane): number | null {
  if (PERMISSION_REASONS.has(p.waitReason)) return 0;
  if (p.attention) return 1;
  if (p.status === "error") return 2;
  if (isWaiting(p.status)) return 3;
  if (!isRunning(p.status) && isUnseen(p)) return 4; // Responded
  if (!isRunning(p.status) && p.markedUnreadAt > 0) return 5; // MarkedUnread
  return null;
}

function ageMinutes(p: LivePane, nowSec: number): number | null {
  const last = p.activityAt || p.startedAt;
  if (last <= 0) return null;
  return Math.max(0, Math.round((nowSec - last) / 60));
}

function loadOverviewByProject(): Map<string, OverviewProject> {
  const map = new Map<string, OverviewProject>();
  try {
    const ov = JSON.parse(readFileSync(OVERVIEW_JSON, "utf8")) as Overview;
    for (const proj of ov.projects) map.set(proj.name, proj);
  } catch {
    /* no overview yet */
  }
  return map;
}

function paneToJson(p: LivePane, nowSec: number, proj?: OverviewProject) {
  return {
    pane_id: p.paneId,
    target: p.target,
    window_id: p.windowId,
    session: p.session,
    project: projectName(p.cwd),
    cwd: p.cwd,
    agent: p.agent,
    status: p.status,
    attention: p.attention,
    wait_reason: p.waitReason || null,
    unseen: isUnseen(p),
    marked_unread: p.markedUnreadAt > 0,
    permission_mode: p.permissionMode || null,
    pane_active: p.paneActive,
    age_minutes: ageMinutes(p, nowSec),
    section: coarseSection(p),
    priority: priorityRank(p),
    prompt: p.prompt,
    current_command: p.currentCommand,
    summary: p.summary,
    pane_name: p.paneName,
    window_name: p.windowName,
    worktree_name: p.worktreeName,
    worktree_branch: p.worktreeBranch,
    bg_cmd: p.bgCmd,
    started_at: p.startedAt,
    last_seen_at: p.lastSeenAt,
    activity_at: p.activityAt,
    doing: proj?.doing ?? "",
    needs_from_you: proj?.needs_from_you ?? null,
    next_steps: proj?.next_steps ?? [],
  };
}

function buildPanes() {
  const panes = collectLive();
  const nowSec = Math.floor(Date.now() / 1000);
  if (panes === null) {
    return { updated_at: nowSec, tmux: false, counts: {}, panes: [] };
  }
  // Port of pending.rs sweep_stale_marks: no running TUI would otherwise clear a
  // pin once the pane stops being purely idle+seen, so it'd stick forever.
  for (const p of panes) {
    if (p.markedUnreadAt > 0 && (p.attention || p.status !== "idle" || isUnseen(p))) {
      tmux(["set", "-t", p.paneId, "-pu", "@dashboard_marked_unread_at"]);
      p.markedUnreadAt = 0;
    }
  }
  const byProject = loadOverviewByProject();
  const items = panes.map((p) => paneToJson(p, nowSec, byProject.get(projectName(p.cwd))));
  const counts = {
    all: panes.length,
    running: panes.filter((p) => p.status === "running").length,
    background: panes.filter((p) => p.status === "background").length,
    waiting: panes.filter((p) => isWaiting(p.status)).length,
    idle: panes.filter((p) => p.status === "idle").length,
    error: panes.filter((p) => p.status === "error").length,
    attention: panes.filter((p) => p.attention).length,
  };
  return { updated_at: nowSec, tmux: true, counts, panes: items };
}

// --- activity ----------------------------------------------------------------

function parseActivityLines(lines: string[]) {
  return lines
    .map((l) => {
      const [time, tool, ...rest] = l.split("|");
      if (!time) return null;
      return { time, tool: tool ?? "", label: rest.join("|") };
    })
    .filter(Boolean);
}

function readActivity(paneId: string, max = 60) {
  const path = activityLogPath(paneId);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trimEnd().split("\n").slice(-max);
  return parseActivityLines(lines);
}

function readRecentActivity(limit: number) {
  let files: string[] = [];
  try {
    files = readdirSync("/tmp")
      .filter((f) => f.startsWith("tmux-agent-activity_") && f.endsWith(".log"))
      .map((f) => `/tmp/${f}`);
  } catch {
    return [];
  }
  const rows: { time: string; tool: string; label: string; pane: string; mtime: number }[] = [];
  for (const f of files) {
    let mtime = 0;
    try {
      mtime = statSync(f).mtimeMs;
    } catch {
      continue;
    }
    const pane = "%" + f.replace("/tmp/tmux-agent-activity_", "").replace(".log", "");
    const lines = readFileSync(f, "utf8").trimEnd().split("\n").slice(-40);
    for (const r of parseActivityLines(lines)) rows.push({ ...(r as any), pane, mtime });
  }
  // No date in the HH:MM stamp; order by file mtime as a proxy, newest first.
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows.slice(0, limit).map(({ mtime, ...r }) => r);
}

// --- transcript --------------------------------------------------------------

function findTranscript(sessionId: string): string | null {
  if (!sessionId) return null;
  let dirs: string[];
  try {
    dirs = readdirSync(PROJECTS_DIR);
  } catch {
    return null;
  }
  const file = `${sessionId}.jsonl`;
  for (const d of dirs) {
    const candidate = join(PROJECTS_DIR, d, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Read the tail of a large append-only JSONL without loading the whole file.
function tailText(path: string, bytes: number): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const fd = readFileSync(path); // Buffer
  return fd.subarray(start).toString("utf8");
}

// Skip synthetic "user" turns - tool results, hook/command wrappers, caveats and
// harness notifications - so the conversation shows only what Kai actually typed.
function isSyntheticUser(t: string): boolean {
  const s = t.trimStart();
  return (
    /^<(task-notification|local-command-caveat|command-name|command-message|command-args|command-contents|user-prompt-submit-hook|system-reminder|bash-input|bash-stdout|bash-stderr)/.test(s) ||
    s.startsWith("Caveat:") ||
    s.startsWith("[Request interrupted")
  );
}

function parseTranscript(sessionId: string, limit: number) {
  const path = findTranscript(sessionId);
  if (!path) return { found: false, entries: [] as unknown[] };
  const text = tailText(path, 256 * 1024);
  const lines = text.split("\n");
  const entries: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // first line is usually a partial record from the tail cut
    }
    const type = obj.type;
    const msg = obj.message;
    if (type === "user" && msg) {
      const content = msg.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content))
        text = content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
      if (text.trim() && !isSyntheticUser(text))
        entries.push({ role: "user", text: text.trim(), ts: obj.timestamp });
    } else if (type === "assistant" && msg && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (b.type === "text" && b.text?.trim())
          entries.push({ role: "assistant", text: b.text.trim(), ts: obj.timestamp });
        else if (b.type === "tool_use")
          entries.push({
            role: "tool_use",
            tool: b.name,
            input: b.input,
            ts: obj.timestamp,
          });
        // thinking blocks intentionally dropped
      }
    }
  }
  return { found: true, entries: entries.slice(-limit) };
}

// --- capture -----------------------------------------------------------------

function capture(paneId: string, lines: number): string {
  const { ok, out } = tmux(["capture-pane", "-p", "-t", paneId, "-S", `-${lines}`]);
  if (!ok) return "";
  return out
    .split("\n")
    .map((l) => (l.length > 400 ? l.slice(0, 400) + "…" : l))
    .join("\n")
    .replace(/\n+$/, "");
}

// --- answering (send-keys) ---------------------------------------------------

// Parse a Claude Code choice menu from a capture-pane frame: numbered "N. label"
// rows (the marker ❯/▶/> may prefix the selected one), plus any indented
// continuation lines beneath an option as its description (AskUserQuestion etc.).
function parseMenu(text: string): { num: number; label: string; description: string }[] {
  const lines = text.split("\n");
  const numbered = /^\s*[❯▶>]?\s*(\d+)\.\s+(.+?)\s*$/;
  const footer = /^\s*(esc|enter|tab|ctrl|↵|⏎|space)\b/i;
  const out: { num: number; label: string; description: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(numbered);
    if (!m) continue;
    const desc: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (numbered.test(l) || footer.test(l) || !l.trim()) break;
      desc.push(l.trim());
    }
    out.push({ num: Number(m[1]), label: m[2]!, description: desc.join(" ") });
  }
  return out;
}

function sendText(paneId: string, text: string) {
  tmux(["send-keys", "-t", paneId, "-l", text]);
  tmux(["send-keys", "-t", paneId, "Enter"]);
}

const KEY_MAP: Record<string, string> = { esc: "Escape", enter: "Enter", up: "Up", down: "Down", "ctrl-v": "C-v", "ctrl-c": "C-c", i: "i" };

function sendKey(paneId: string, key: string) {
  if (/^[0-9]$/.test(key)) {
    // Digit selects the option; Enter confirms it (menus that don't auto-submit).
    tmux(["send-keys", "-t", paneId, "-l", key]);
    tmux(["send-keys", "-t", paneId, "Enter"]);
  } else if (KEY_MAP[key]) {
    tmux(["send-keys", "-t", paneId, KEY_MAP[key]!]);
  }
}

// --- actions -----------------------------------------------------------------

const paneExists = collectOne;

// Run several tmux commands in one process; `;` (its own arg) separates them.
function tmuxChain(cmds: string[][]) {
  const args: string[] = [];
  cmds.forEach((c, i) => {
    if (i) args.push(";");
    args.push(...c);
  });
  tmux(args);
}

function markSeen(paneId: string) {
  tmuxChain([
    ["set", "-t", paneId, "-p", "@pane_last_seen_at", String(Math.floor(Date.now() / 1000))],
    ["refresh-client", "-S"],
  ]);
}

function markUnread(paneId: string, on: boolean) {
  const set = on
    ? ["set", "-t", paneId, "-p", "@dashboard_marked_unread_at", String(Math.floor(Date.now() / 1000))]
    : ["set", "-t", paneId, "-pu", "@dashboard_marked_unread_at"];
  tmuxChain([set, ["refresh-client", "-S"]]);
}

function clearPending(paneId: string) {
  tmuxChain([
    ["set", "-t", paneId, "-pu", "@pane_attention"],
    ["set", "-t", paneId, "-pu", "@pane_status"],
    ["set", "-t", paneId, "-pu", "@pane_wait_reason"],
    ["set", "-t", paneId, "-pu", "@dashboard_marked_unread_at"],
    ["set", "-t", paneId, "-p", "@pane_last_seen_at", String(Math.floor(Date.now() / 1000))],
    ["refresh-client", "-S"],
  ]);
}

function gotoPane(p: LivePane) {
  const cmds: string[][] = [];
  if (p.session) cmds.push(["switch-client", "-t", p.session]);
  if (p.windowId) cmds.push(["select-window", "-t", p.windowId]);
  cmds.push(["select-pane", "-t", p.paneId]);
  cmds.push(["set", "-t", p.paneId, "-p", "@pane_last_seen_at", String(Math.floor(Date.now() / 1000))]);
  cmds.push(["refresh-client", "-S"]);
  tmuxChain(cmds);
}

// --- server ------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

Bun.serve({
  port: BRIDGE_PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return json({});

    // /health is the only unauthenticated route (connectivity probe, no data).
    if (req.method === "GET" && path === "/health") return json({ ok: true, auth: !!TOKEN });

    // Everything else is token-gated: the read endpoints carry CONFIDENTIAL
    // cross-client agent data, so LAN reachability alone must not grant access.
    if (!authOk(req)) {
      return json({ error: TOKEN ? "unauthorized" : "bridge token not configured" }, 401);
    }

    if (req.method === "GET" && path === "/panes") return json(buildPanes());
    if (req.method === "GET" && path === "/overview/full") {
      try {
        return json(JSON.parse(readFileSync(OVERVIEW_JSON, "utf8")));
      } catch {
        return json({ updated_at: 0, tldr: [], projects: [], idle: [] });
      }
    }
    if (req.method === "GET" && path === "/activity/recent") {
      const limit = Number(url.searchParams.get("limit") ?? "200");
      return json({ activity: readRecentActivity(limit) });
    }
    if (req.method === "GET" && path === "/activity") {
      const pane = url.searchParams.get("pane_id");
      if (!pane) return json({ error: "pane_id required" }, 400);
      return json({ pane_id: pane, activity: readActivity(pane) });
    }

    if (req.method === "GET" && path === "/transcript") {
      const pane = url.searchParams.get("pane_id");
      if (!pane) return json({ error: "pane_id required" }, 400);
      const live = paneExists(pane);
      if (!live) return json({ error: "unknown pane" }, 404);
      const limit = Number(url.searchParams.get("limit") ?? "40");
      return json({ pane_id: pane, session_id: live.sessionId, ...parseTranscript(live.sessionId, limit) });
    }
    if (req.method === "GET" && path === "/screen") {
      const pane = url.searchParams.get("pane_id");
      if (!pane) return json({ error: "pane_id required" }, 400);
      const lines = Number(url.searchParams.get("lines") ?? "60");
      return json({ pane_id: pane, text: capture(pane, lines) });
    }
    if (req.method === "GET" && path === "/prompt") {
      const pane = url.searchParams.get("pane_id");
      if (!pane) return json({ error: "pane_id required" }, 400);
      const live = paneExists(pane);
      if (!live) return json({ error: "unknown pane" }, 404);
      const screen = capture(pane, 30);
      const options = parseMenu(screen);
      return json({
        pane_id: pane,
        agent: live.agent,
        status: live.status,
        wait_reason: live.waitReason || null,
        waiting: isWaiting(live.status) || PERMISSION_REASONS.has(live.waitReason),
        options,
        screen,
      });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        pane_id?: string;
        on?: boolean;
        text?: string;
        key?: string;
      };
      if (!body.pane_id) return json({ error: "pane_id required" }, 400);
      const live = paneExists(body.pane_id);
      if (!live) return json({ ok: false, error: "unknown pane" }, 404);
      switch (path) {
        case "/seen":
          markSeen(live.paneId);
          audit("seen", live.paneId);
          return json({ ok: true });
        case "/mark-unread":
          markUnread(live.paneId, body.on ?? true);
          audit("mark-unread", live.paneId, String(body.on ?? true));
          return json({ ok: true });
        case "/clear":
          clearPending(live.paneId);
          audit("clear", live.paneId);
          return json({ ok: true });
        case "/goto":
          gotoPane(live);
          audit("goto", live.paneId);
          return json({ ok: true });
        case "/send": {
          // Free-text reply - keystroke injection, so gate hard on a claude pane.
          if (live.agent !== "claude") return json({ ok: false, error: "not a claude pane" }, 400);
          if (!body.text) return json({ ok: false, error: "text required" }, 400);
          sendText(live.paneId, body.text);
          audit("send", live.paneId, `${body.text.length} chars`);
          return json({ ok: true, echo: capture(live.paneId, 12) });
        }
        case "/answer": {
          if (live.agent !== "claude") return json({ ok: false, error: "not a claude pane" }, 400);
          const key = String(body.key ?? "");
          // Re-verify the live menu right before sending - options can change.
          if (/^[0-9]$/.test(key)) {
            const menu = parseMenu(capture(live.paneId, 30));
            if (!menu.some((o) => o.num === Number(key)))
              return json({ ok: false, error: "option not on screen", options: menu }, 409);
          } else if (!KEY_MAP[key]) {
            return json({ ok: false, error: "bad key" }, 400);
          }
          sendKey(live.paneId, key);
          audit("answer", live.paneId, `key=${key}`);
          return json({ ok: true, echo: capture(live.paneId, 12) });
        }
      }
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`agent-bridge listening on 0.0.0.0:${BRIDGE_PORT} (auth ${TOKEN ? "on" : "OFF - set token"})`);
