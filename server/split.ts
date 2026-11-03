// Detect an interactive prompt in a NON-agent pane (the shell/CLI split next to an
// agent): sudo password, (y/N), inquirer/prompts/clack lists, numbered menus, text
// inputs. Pure text in, so it's testable without tmux.

import { parseMenu, type MenuOption } from "./menu";

export type SplitKind = "yesno" | "menu" | "select" | "input" | "enter" | "password";

export interface SplitPrompt {
  kind: SplitKind;
  question: string;
  options: MenuOption[];
  // select only: 0-based index of the highlighted option
  selected: number | null;
}

// Foreground commands that are never a pending prompt (editors, pagers, monitors).
export const NO_PROMPT_COMMANDS = new Set(["nvim", "vim", "vi", "nano", "less", "more", "man", "htop", "btop", "top", "tmux"]);
// Interactive login shells: only worth a look when something runs under them
// (`split-window "cmd"` runs via a non-interactive fish -c, which tmux reports as fish).
export const IDLE_SHELLS = new Set(["fish", "zsh", "nu"]);

const PASSWORD = /(\[sudo\] password for .*|(password|passphrase|passcode|pin)\b[^:]*):\s*$/i;
const YESNO = /[(\[]\s*(y|yes)\s*\/\s*(n|no)\s*[)\]]/i;
const ENTER = /press (enter|return)( key)? to (continue|proceed|confirm|exit)|press any key/i;
// inquirer / prompts / clack question line: "? Name ›", "✔ x", "◆  Pick"
const QUESTION = /^[\s│]*[?◆◇]\s+(.+?)\s*$/;
const INPUT = /^[\s│]*[?◆◇]\s+.+?(›|:|\?)\s*\S*\s*$/;
const MARKED = /^([\s│]*)([❯›>●◉])(\s+)(\S.*?)\s*$/;
const UNMARKED = /^([\s│]*)([○◯]?)(\s*)(\S.*?)\s*$/;

const clean = (s: string) => s.replace(/^[\s│?◆◇]+/, "").trim();

// screen = visible pane text (no scrollback), cursorY = tmux #{cursor_y}.
export function detectPrompt(screen: string, cursorY: number): SplitPrompt | null {
  const all = screen.split("\n");
  let end = all.length;
  while (end > 0 && !all[end - 1]!.trim()) end--;
  end = Math.max(end, Math.min(all.length, cursorY + 1));
  const region = all.slice(Math.max(0, end - 20), end);
  const nonEmpty = region.filter((l) => l.trim());
  if (!nonEmpty.length) return null;
  const last = nonEmpty[nonEmpty.length - 1]!;
  const cursorLine = all[cursorY] ?? "";
  const tail = [cursorLine, last];

  const pw = tail.find((l) => PASSWORD.test(l));
  if (pw) return { kind: "password", question: pw.trim(), options: [], selected: null };

  const yn = tail.find((l) => YESNO.test(l));
  if (yn) {
    const m = yn.match(YESNO)!;
    return { kind: "yesno", question: clean(yn.slice(0, m.index! + m[0].length)), options: [], selected: null };
  }

  // Numbered menus only with a selection marker; plain numbered log output is too common.
  if (region.some((l) => /^\s*[❯▶>]\s*\d+\.\s+\S/.test(l))) {
    const options = parseMenu(region.join("\n"));
    if (options.length >= 2) {
      const first = region.findIndex((l) => /^\s*[❯▶>]?\s*\d+\.\s+\S/.test(l));
      const q = region.slice(0, Math.max(0, first)).filter((l) => l.trim()).pop() ?? "";
      return { kind: "menu", question: clean(q), options, selected: null };
    }
  }

  const sel = detectSelect(region);
  if (sel) return sel;

  const inp = tail.find((l) => INPUT.test(l));
  if (inp) return { kind: "input", question: clean(inp.replace(/(›|:)\s*\S*\s*$/, "")), options: [], selected: null };

  const en = nonEmpty.slice(-3).find((l) => ENTER.test(l));
  if (en) return { kind: "enter", question: en.trim(), options: [], selected: null };

  return null;
}

// Arrow-key list: exactly one marked row, unmarked siblings whose label starts in
// the same column. A single marked line (shell prompt, expo's "› Press a") is not a list.
function detectSelect(region: string[]): SplitPrompt | null {
  let m = -1;
  for (let i = region.length - 1; i >= 0; i--) {
    if (MARKED.test(region[i]!)) {
      m = i;
      break;
    }
  }
  if (m < 0) return null;
  const mm = region[m]!.match(MARKED)!;
  const col = mm[1]!.length + mm[2]!.length + mm[3]!.length;
  const sameCol = (l: string) => {
    const u = l.match(UNMARKED);
    return !!u && !MARKED.test(l) && u[1]!.length + u[2]!.length + u[3]!.length === col;
  };
  let start = m;
  while (start > 0 && sameCol(region[start - 1]!)) start--;
  let stop = m;
  while (stop + 1 < region.length && sameCol(region[stop + 1]!)) stop++;
  if (stop - start < 1) return null;

  // The question sits right above the list; without one it's just aligned output.
  const above = region.slice(0, start).filter((l) => l.trim());
  const q = above[above.length - 1] ?? "";
  if (!QUESTION.test(q)) return null;

  const options: MenuOption[] = [];
  for (let i = start; i <= stop; i++) {
    const l = region[i]!;
    const label = (l.match(MARKED) ?? l.match(UNMARKED))![4]!.replace(/^-\s+/, "");
    options.push({ num: i - start + 1, label, description: "" });
  }
  return {
    kind: "select",
    question: clean(q.replace(/\s*›.*$/, "").replace(/\s*\(Use arrow keys.*$/i, "")),
    options,
    selected: m - start,
  };
}

export const SPLIT_LABEL: Record<SplitKind, string> = {
  yesno: "split: y/n",
  menu: "split: choice",
  select: "split: choice",
  input: "split: input",
  enter: "split: press enter",
  password: "split: password",
};
