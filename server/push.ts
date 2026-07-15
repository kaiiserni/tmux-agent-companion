// Self-hosted APNs push (bucket 4, layer A). Own auth key, never Expo Push
// Service — agent data is CONFIDENTIAL across clients, so nothing but a generic
// alert + the non-confidential pane_id ever transits Apple. See
// todo/push-notifications-plan.md.
import http2 from "node:http2";
import { sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_ID = process.env.APNS_KEY_ID ?? "8M2QS96LZ9";
const TEAM_ID = process.env.APNS_TEAM_ID ?? "8E7JB82GJK";
const TOPIC = process.env.APNS_TOPIC ?? "com.kaiiserni.tmuxagentcompanion";
const KEY_FILE = process.env.APNS_KEY_FILE ?? join(homedir(), ".config/agent-bridge/apns/AuthKey_8M2QS96LZ9.p8");
const TOKENS_FILE = join(homedir(), ".local/state/agent-bridge/push-tokens.json");

export type PushEnv = "sandbox" | "production";
const HOSTS: Record<PushEnv, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

let KEY: Buffer | null = null;
try {
  if (existsSync(KEY_FILE)) KEY = readFileSync(KEY_FILE);
} catch {
  /* unreadable → push stays disabled */
}

export const pushConfigured = (): boolean => KEY !== null;

// ── JWT (ES256), cached: Apple wants it refreshed < 60 min and reused ≥ 20 ──
let jwtCache: { token: string; iat: number } | null = null;
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function providerJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  if (jwtCache && now - jwtCache.iat < 50 * 60) return jwtCache.token;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: now }));
  const input = `${header}.${claims}`;
  // ES256 JWT needs a JOSE (raw R||S) signature, not DER — dsaEncoding does that.
  const sig = cryptoSign("sha256", Buffer.from(input), { key: KEY!, dsaEncoding: "ieee-p1363" });
  const token = `${input}.${b64url(sig)}`;
  jwtCache = { token, iat: now };
  return token;
}

// ── persistent HTTP/2 sessions, one per env, reconnect on close/error ──
const sessions: Partial<Record<PushEnv, http2.ClientHttp2Session>> = {};
function session(env: PushEnv): http2.ClientHttp2Session {
  const cur = sessions[env];
  if (cur && !cur.closed && !cur.destroyed) return cur;
  const s = http2.connect(HOSTS[env]);
  s.on("error", () => {
    if (sessions[env] === s) delete sessions[env];
  });
  s.on("close", () => {
    if (sessions[env] === s) delete sessions[env];
  });
  s.on("goaway", () => {
    try {
      s.close();
    } catch {
      /* already gone */
    }
  });
  sessions[env] = s;
  return s;
}

type SendResult = { status: number; reason?: string };
function sendOne(env: PushEnv, deviceToken: string, body: string, collapseId?: string): Promise<SendResult> {
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      const headers: Record<string, string> = {
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${providerJwt()}`,
        "apns-topic": TOPIC,
        "apns-push-type": "alert",
        "apns-priority": "10",
      };
      if (collapseId) headers["apns-collapse-id"] = collapseId.slice(0, 64);
      req = session(env).request(headers);
    } catch (e) {
      return resolve({ status: 0, reason: (e as Error).message });
    }
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.on("response", (h) => (status = Number(h[":status"] ?? 0)));
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let reason: string | undefined;
      try {
        reason = data ? (JSON.parse(data).reason as string) : undefined;
      } catch {
        /* no json body (200 has none) */
      }
      resolve({ status, reason });
    });
    req.on("error", (e) => resolve({ status: 0, reason: e.message }));
    req.end(body);
  });
}

// ── device-token store ──
type TokenRec = { env: PushEnv; updatedAt: number };
function loadTokens(): Record<string, TokenRec> {
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveTokens(t: Record<string, TokenRec>): void {
  mkdirSync(dirname(TOKENS_FILE), { recursive: true });
  writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

export function registerToken(token: string, env: PushEnv): void {
  const t = loadTokens();
  t[token] = { env, updatedAt: Math.floor(Date.now() / 1000) };
  saveTokens(t);
}
function setTokenEnv(token: string, env: PushEnv): void {
  const t = loadTokens();
  if (t[token] && t[token].env !== env) {
    t[token].env = env;
    saveTokens(t);
  }
}
export function dropToken(token: string): void {
  const t = loadTokens();
  if (t[token]) {
    delete t[token];
    saveTokens(t);
  }
}
export const tokenCount = (): number => Object.keys(loadTokens()).length;

// Apple's terminal verdicts on a token: prune it so a flapping loop can't keep retrying.
const DEAD_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export type AlertInput = { title: string; body: string; paneId?: string; collapseId?: string; threadId?: string };
export async function sendAlert(a: AlertInput): Promise<{ sent: number; pruned: number; results: SendResult[] }> {
  if (!pushConfigured()) return { sent: 0, pruned: 0, results: [] };
  const tokens = loadTokens();
  const payload = JSON.stringify({
    aps: {
      alert: { title: a.title, body: a.body },
      sound: "default",
      "thread-id": a.threadId ?? "agent-attention",
    },
    ...(a.paneId ? { pane_id: a.paneId } : {}),
  });
  let sent = 0;
  let pruned = 0;
  const results: SendResult[] = [];
  for (const [token, rec] of Object.entries(tokens)) {
    let r = await sendOne(rec.env, token, payload, a.collapseId);
    // The APNs environment is baked into the build's aps-environment entitlement,
    // which doesn't always match the client's guess (EAS dev builds can ship the
    // production entitlement → a production token). On a host mismatch, try the
    // other host and remember it if it works — self-healing, no client round-trip.
    if (r.status !== 200 && (r.reason === "BadDeviceToken" || r.reason === "DeviceTokenNotForTopic")) {
      const other: PushEnv = rec.env === "sandbox" ? "production" : "sandbox";
      const alt = await sendOne(other, token, payload, a.collapseId);
      if (alt.status === 200) setTokenEnv(token, other);
      if (alt.status) r = alt;
    }
    results.push(r);
    if (r.status === 200) sent++;
    else if (r.status === 410 || (r.reason && DEAD_REASONS.has(r.reason))) {
      dropToken(token);
      pruned++;
    }
  }
  return { sent, pruned, results };
}
