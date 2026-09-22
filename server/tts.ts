// Text-to-speech for transcript replies, via CanaryLLM (ElevenLabs). The gateway
// is queue-based: submit → poll status → fetch base64 mp3, never a binary body on
// submit. Renders are cached on disk by content hash because ElevenLabs bills per
// character, so a replay or a re-render of the same reply costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = process.env.CANARYLLM_API_BASE ?? "https://canaryllm.canarycoders.es";
const KEY_FILE = process.env.CANARYLLM_KEY_FILE ?? join(homedir(), ".config/agent-bridge/canaryllm");
// Jessica - same voice as the `speak` CLI on the dev box.
const VOICE_ID = process.env.TTS_VOICE_ID ?? "cgSgspJ2msm6clMCkdW9";
const CACHE_DIR = join(homedir(), ".local/state/agent-bridge/tts");
const MAX_CHARS = 1200;
const POLL_TIMEOUT_MS = 120_000;

function loadKey(): string {
  if (process.env.CANARYLLM_API_KEY) return process.env.CANARYLLM_API_KEY.trim();
  try {
    return readFileSync(KEY_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
const KEY = loadKey();

export const ttsConfigured = (): boolean => KEY !== "";

// Markdown reads terribly out loud: drop code blocks entirely, unwrap the rest.
export function speakable(md: string): string {
  let t = md.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  t = t.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");
  t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  t = t.replace(/\*\*|__|~~/g, "");
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (stop > MAX_CHARS * 0.6 ? cut.slice(0, stop) : cut).trim();
}

const audioPath = (id: string) => join(CACHE_DIR, `${id}.mp3`);

// The id lands in a filesystem path, so only ever accept a hash we could have made.
export function audioFile(id: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const p = audioPath(id);
  return existsSync(p) ? p : null;
}

async function api(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function render(id: string, text: string): Promise<void> {
  const submit = await api("/api/llm/generate-audio", {
    provider: "elevenlabs",
    text,
    voiceId: VOICE_ID,
    outputFormat: "mp3_44100_128",
  });
  const queueId = submit?.data?.queueId;
  if (!queueId) throw new Error("no queueId from generate-audio");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const st = await api("/api/llm/queue/status", { queueId });
    const status = st?.data?.status ?? "unknown";
    if (status === "completed") break;
    if (status === "error" || status === "cancelled" || status === "not_found") throw new Error(`tts job ${status}`);
    if (Date.now() > deadline) throw new Error("tts timed out");
    await Bun.sleep(700);
  }

  const out = await api("/api/llm/queue/result", { queueId });
  const b64 = out?.data?.result?.audio;
  if (!b64) throw new Error("no audio in tts result");
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${audioPath(id)}.part`;
  writeFileSync(tmp, Buffer.from(b64, "base64"));
  renameSync(tmp, audioPath(id));
}

const inflight = new Map<string, Promise<void>>();

export async function synthesize(text: string): Promise<{ id: string; chars: number; cached: boolean }> {
  const clean = speakable(text);
  if (!clean) throw new Error("nothing to speak");
  const id = createHash("sha256").update(`${VOICE_ID}\n${clean}`).digest("hex");
  if (existsSync(audioPath(id))) return { id, chars: clean.length, cached: true };
  let p = inflight.get(id);
  if (!p) {
    p = render(id, clean).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  await p;
  return { id, chars: clean.length, cached: false };
}
