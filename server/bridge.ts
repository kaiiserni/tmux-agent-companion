import { timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cpus, freemem, homedir, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { activityLogPath, activityMtime, projectName } from "./lib";
import { parseMenu } from "./menu";
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
  // Exclude grouped term_* sessions: they share windows with the real session,
  // so list-panes -a would list every shared pane twice (with the wrong target).
  const { ok, out } = tmux(["list-panes", "-a", "-f", "#{==:#{m:term_*,#{session_name}},0}", "-F", LIST_FORMAT]);
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

// --- system stats + Claude usage ---------------------------------------------

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

// Sample twice ~200ms apart so the % is self-contained per request (no shared state).
async function cpuPercent(): Promise<number> {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 200));
  const b = cpuSnapshot();
  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  return dt <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
}

function memStats() {
  const total = totalmem();
  // macOS freemem() undercounts (excludes cached/inactive); vm_stat gives a realistic
  // "used" (active + wired + compressed), matching Activity Monitor / the tmux-cpu bar.
  if (process.platform === "darwin") {
    try {
      const out = Bun.spawnSync(["vm_stat"]).stdout.toString();
      const ps = Number(out.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
      const pages = (re: RegExp) => Number(out.match(re)?.[1] ?? 0) * ps;
      const used = pages(/Pages active:\s+(\d+)/) + pages(/Pages wired down:\s+(\d+)/) + pages(/Pages occupied by compressor:\s+(\d+)/);
      if (used > 0) return { used, total, percent: Math.round((used / total) * 100) };
    } catch {
      /* fall through to os */
    }
  }
  const used = total - freemem();
  return { used, total, percent: Math.round((used / total) * 100) };
}

async function systemStats() {
  return { cpu: await cpuPercent(), mem: memStats(), load: loadavg().map((n) => Math.round(n * 100) / 100) };
}

const USAGE_RAW = "/tmp/claude-usage-raw.json";
function claudeUsage() {
  const pick = (o: { utilization?: number; resets_at?: string } | undefined) =>
    o ? { utilization: o.utilization ?? null, resets_at: o.resets_at ?? null } : null;
  try {
    const j = JSON.parse(readFileSync(USAGE_RAW, "utf8"));
    return {
      updated_at: Math.floor(statSync(USAGE_RAW).mtimeMs / 1000),
      plan: j.subscription_type ?? j.plan ?? null,
      five_hour: pick(j.five_hour),
      seven_day: pick(j.seven_day),
      seven_day_opus: pick(j.seven_day_opus),
    };
  } catch {
    return { updated_at: 0, plan: null, five_hour: null, seven_day: null, seven_day_opus: null };
  }
}

// --- answering (send-keys) ---------------------------------------------------

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

// --- terminal (PTY sidecar over WebSocket) -----------------------------------
// node-pty won't spawn under Bun (posix_spawnp fails); it works under Node. So the
// PTY runs in a Node sidecar (pty-bridge.cjs) that we Bun.spawn per WS connection.

const NODE_BIN = process.env.NODE_BIN || "/opt/homebrew/bin/node";
const TMUX_BIN = process.env.TMUX_BIN || "/opt/homebrew/bin/tmux";
const PTY_BRIDGE = join(import.meta.dir, "pty-bridge.cjs");
const XTERM_DIR = join(import.meta.dir, "node_modules/@xterm");

function tokenOk(raw: string): boolean {
  if (!TOKEN) return false;
  const a = Buffer.from(raw);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface TermData {
  paneId: string;
  session: string;
  winIndex: string;
  cols: number;
  rows: number;
  termSession?: string;
  child?: ReturnType<typeof Bun.spawn>;
}

// Frame control messages onto the sidecar's stdin: [type:1][len:4 BE][payload].
function writeFrame(child: ReturnType<typeof Bun.spawn> | undefined, type: number, payload: Buffer) {
  const sink = child?.stdin as import("bun").FileSink | undefined;
  if (!sink) return;
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(payload.length, 1);
  sink.write(header);
  sink.write(payload);
  sink.flush();
}

// Clean up any leftover terminal sessions from a previous crash.
for (const s of tmux(["list-sessions", "-F", "#{session_name}"]).out.split("\n")) {
  if (s.startsWith("term_")) tmux(["kill-session", "-t", s]);
}

function readVendor(p: string): string {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

const TERM_BOOTSTRAP = `
var ESC=String.fromCharCode(27), CRLF=String.fromCharCode(13,10);
var params=new URLSearchParams(location.search);
var th={background:'#1a1b26',foreground:'#c0caf5',cursor:'#c0caf5',selectionBackground:'#33467c',black:'#15161e',red:'#f7768e',green:'#9ece6a',yellow:'#e0af68',blue:'#7aa2f7',magenta:'#bb9af7',cyan:'#7dcfff',white:'#c0caf5',brightBlack:'#414868',brightRed:'#f7768e',brightGreen:'#9ece6a',brightYellow:'#e0af68',brightBlue:'#7aa2f7',brightMagenta:'#bb9af7',brightCyan:'#7dcfff',brightWhite:'#c0caf5'};
var term=new Terminal({fontFamily:'SauceCodePro, Menlo, Monaco, monospace',fontSize:12,theme:th,cursorBlink:true,allowProposedApi:true,scrollback:3000});
var FA=(window.FitAddon&&window.FitAddon.FitAddon)||window.FitAddon;
var fit=new FA();term.loadAddon(fit);term.open(document.getElementById('t'));
try{fit.fit();}catch(e){}
var ctrl=false, alt=false, mouse=false;
function wsurl(){return (location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/terminal?pane_id='+encodeURIComponent(params.get('pane_id')||'')+'&token='+encodeURIComponent(params.get('token')||'')+'&cols='+term.cols+'&rows='+term.rows;}
var ws;
function send(o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o));}
function input(d){send({t:'i',d:d});}
function doFit(){try{fit.fit();}catch(e){}send({t:'r',c:term.cols,r:term.rows});}
function connect(){ws=new WebSocket(wsurl());ws.binaryType='arraybuffer';
  ws.onopen=function(){doFit();send({t:'m',c:mouse?1:0});term.focus();};
  ws.onmessage=function(e){term.write(typeof e.data==='string'?e.data:new Uint8Array(e.data));};
  ws.onclose=function(){term.write(CRLF+'[disconnected - reconnecting]'+CRLF);setTimeout(connect,1500);};
}
function syncMods(){document.getElementById('bctrl').className=ctrl?'on':'';document.getElementById('balt').className=alt?'on':'';}
// ctrl transforms the raw first char; alt prefixes ESC afterwards, so ctrl+alt composes.
function applyMods(d){
  if(ctrl){var c=d.charCodeAt(0);if(c>=97&&c<=122)d=String.fromCharCode(c-96)+d.slice(1);else if(c>=64&&c<=95)d=String.fromCharCode(c-64)+d.slice(1);}
  if(alt)d=ESC+d;
  if(ctrl||alt){ctrl=false;alt=false;syncMods();}
  return d;
}
term.onData(function(d){input(applyMods(d));});
var KEYS={esc:ESC,tab:String.fromCharCode(9),up:ESC+'[A',down:ESC+'[B',left:ESC+'[D',right:ESC+'[C',cc:String.fromCharCode(3),cd:String.fromCharCode(4),cz:String.fromCharCode(26),home:ESC+'[H',end:ESC+'[F',pgup:ESC+'[5~',pgdn:ESC+'[6~',pipe:'|',tilde:'~',slash:'/',dash:'-'};
function fontDelta(n){term.options.fontSize=Math.max(8,Math.min(20,term.options.fontSize+n));doFit();}
Array.prototype.forEach.call(document.querySelectorAll('#bar button'),function(b){
  b.addEventListener('click',function(ev){ev.preventDefault();
    var k=b.getAttribute('data-k'),m=b.getAttribute('data-mod');
    if(k){input(applyMods(KEYS[k]));}
    else if(m==='ctrl'){ctrl=!ctrl;syncMods();}
    else if(m==='alt'){alt=!alt;syncMods();}
    else if(b.id==='bmouse'){mouse=!mouse;send({t:'m',c:mouse?1:0});b.className=mouse?'on':'';}
    else if(b.id==='bfdn'){fontDelta(-1);}
    else if(b.id==='bfup'){fontDelta(1);}
    term.focus();
  });
});
window.addEventListener('resize',doFit);connect();
`;

const TERM_BAR =
  '<div id=bar>' +
  '<button data-k=esc>esc</button><button data-k=tab>tab</button>' +
  '<button id=bctrl data-mod=ctrl>ctrl</button><button id=balt data-mod=alt>alt</button>' +
  '<button data-k=up>↑</button><button data-k=down>↓</button><button data-k=left>←</button><button data-k=right>→</button>' +
  '<button data-k=cc>^C</button><button data-k=cd>^D</button><button data-k=cz>^Z</button>' +
  '<button data-k=home>home</button><button data-k=end>end</button><button data-k=pgup>pgup</button><button data-k=pgdn>pgdn</button>' +
  '<button data-k=pipe>|</button><button data-k=tilde>~</button><button data-k=slash>/</button><button data-k=dash>-</button>' +
  '<button id=bmouse>🖱 mouse</button><button id=bfdn>A−</button><button id=bfup>A+</button>' +
  '</div>';

const TERM_STYLE =
  "html,body{margin:0;height:100%;background:#1a1b26;overflow:hidden}" +
  "body{display:flex;flex-direction:column}#t{flex:1;min-height:0;padding:2px}" +
  "#bar{display:flex;gap:6px;padding:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:#15161e;border-top:1px solid #414868;flex:none}" +
  "#bar button{flex:none;font:600 13px/1 SauceCodePro,Menlo,monospace;color:#a9b1d6;background:#24283b;border:1px solid #414868;border-radius:7px;padding:9px 11px;min-width:34px}" +
  "#bar button.on{color:#1a1b26;background:#7aa2f7;border-color:#7aa2f7}" +
  "@font-face{font-family:'SauceCodePro';src:url('/term-font.ttf') format('truetype');font-display:swap}";

function buildTermHtml(): string {
  const css = readVendor(join(XTERM_DIR, "xterm/css/xterm.css"));
  const xterm = readVendor(join(XTERM_DIR, "xterm/lib/xterm.js"));
  const fit = readVendor(join(XTERM_DIR, "addon-fit/lib/addon-fit.js"));
  return (
    "<!doctype html><html><head><meta charset=utf-8>" +
    '<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
    "<style>" + css + "\n" + TERM_STYLE + "</style>" +
    "</head><body><div id=t></div>" + TERM_BAR +
    "<script>" + xterm + "</script><script>" + fit + "</script>" +
    "<script>" + TERM_BOOTSTRAP + "</script></body></html>"
  );
}
const TERM_HTML = buildTermHtml();
const TERM_FONT: ArrayBuffer | null = (() => {
  try {
    const b = readFileSync(join(import.meta.dir, "../assets/fonts/SauceCodeProNerdFont-Regular.ttf"));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
})();

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

Bun.serve<TermData>({
  port: BRIDGE_PORT,
  hostname: "0.0.0.0",
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return json({});

    // /health is the only unauthenticated route (connectivity probe, no data).
    if (req.method === "GET" && path === "/health") return json({ ok: true, auth: !!TOKEN });

    // Terminal WebSocket: a browser WS can't send an Authorization header, so the
    // token comes via query param (constant-time checked). Upgrade before the gate.
    if (path === "/terminal") {
      if (!tokenOk(url.searchParams.get("token") ?? "")) return json({ error: "unauthorized" }, 401);
      const paneId = url.searchParams.get("pane_id") ?? "";
      const live = paneExists(paneId);
      if (!live) return json({ error: "unknown pane" }, 404);
      const winIndex = live.target.split(":")[1]?.split(".")[0] ?? "";
      const ok = server.upgrade(req, {
        data: {
          paneId: live.paneId,
          session: live.session,
          winIndex,
          cols: Math.max(20, Number(url.searchParams.get("cols") ?? "80")),
          rows: Math.max(8, Number(url.searchParams.get("rows") ?? "24")),
        },
      });
      return ok ? undefined : json({ error: "upgrade failed" }, 400);
    }

    // The xterm.js web UI. Open (no data of its own); the WS it opens is token-gated.
    if (req.method === "GET" && path === "/term") return htmlResponse(TERM_HTML);
    if (req.method === "GET" && path === "/term-font.ttf") {
      if (!TERM_FONT) return new Response("", { status: 404 });
      return new Response(TERM_FONT, {
        headers: { "Content-Type": "font/ttf", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" },
      });
    }

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

    if (req.method === "GET" && path === "/system") return json(await systemStats());
    if (req.method === "GET" && path === "/claude-usage") return json(claudeUsage());

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
  websocket: {
    open(ws) {
      const d = ws.data;
      const termSession = `term_${d.paneId.replace("%", "")}_${Date.now() % 100000}`;
      d.termSession = termSession;
      // Grouped session: own current window, but windows (and their size!) are shared —
      // the phone drives the shared window size while attached (pty-bridge clamps ≥20x8).
      // status off is per-session; a pane-border-status line may still show (window option).
      const setup: string[][] = [
        ["new-session", "-d", "-s", termSession, "-t", d.session],
        ["set-option", "-t", termSession, "destroy-unattached", "off"],
        ["set-option", "-t", termSession, "status", "off"],
        ["set-option", "-t", termSession, "mouse", "off"], // mouse button toggles it
        ["set-option", "-t", termSession, "window-size", "latest"],
      ];
      if (d.winIndex) setup.push(["select-window", "-t", `${termSession}:${d.winIndex}`]);
      tmuxChain(setup);
      const child = Bun.spawn([NODE_BIN, PTY_BRIDGE, termSession, String(d.cols), String(d.rows)], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        env: { ...process.env, TMUX_BIN, HOME: homedir() },
      });
      d.child = child;
      audit("terminal-open", d.paneId, termSession);
      (async () => {
        try {
          for await (const chunk of child.stdout as ReadableStream<Uint8Array>) ws.send(chunk);
        } catch {
          /* stream closed */
        }
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      })();
    },
    message(ws, message) {
      const d = ws.data;
      if (!d.child) return;
      let m: { t?: string; d?: string; c?: number; r?: number };
      try {
        m = JSON.parse(typeof message === "string" ? message : message.toString());
      } catch {
        return;
      }
      if (m.t === "i" && typeof m.d === "string") writeFrame(d.child, 0, Buffer.from(m.d, "utf8"));
      else if (m.t === "r") writeFrame(d.child, 1, Buffer.from(`${m.c ?? 80},${m.r ?? 24}`));
      else if (m.t === "m" && d.termSession) tmux(["set-option", "-t", d.termSession, "mouse", m.c ? "on" : "off"]);
    },
    close(ws) {
      const d = ws.data;
      try {
        d.child?.kill();
      } catch {
        /* already gone */
      }
      // After kill-session the shared window snaps back to the desktop client's
      // size as soon as that client views it (window-size latest).
      if (d.termSession) tmux(["kill-session", "-t", d.termSession]);
      audit("terminal-close", d.paneId, d.termSession ?? "");
    },
  },
});

console.log(`agent-bridge listening on 0.0.0.0:${BRIDGE_PORT} (auth ${TOKEN ? "on" : "OFF - set token"})`);
