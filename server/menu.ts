// Parse a Claude Code choice menu from a capture-pane frame: numbered "N. label"
// rows (marker ❯/▶/> may prefix the selected one) + indented continuation lines
// as the option's description (AskUserQuestion etc.).

export interface MenuOption {
  num: number;
  label: string;
  description: string;
}

interface Entry extends MenuOption {
  indent: number; // column of the option number
  marked: boolean;
}

const NUMBERED = /^(\s*[❯▶>]?\s*)(\d+)\.\s+(.+?)\s*$/;
const FOOTER = /^\s*(esc|enter|tab|ctrl|↵|⏎|space)\b/i;

export function parseMenu(text: string): MenuOption[] {
  const lines = text.split("\n");
  const entries: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(NUMBERED);
    if (!m) continue;
    const desc: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (NUMBERED.test(l) || FOOTER.test(l) || !l.trim()) break;
      desc.push(l.trim());
    }
    entries.push({
      num: Number(m[2]),
      label: m[3]!,
      description: desc.join(" "),
      indent: m[1]!.length,
      marked: /[❯▶>]/.test(m[1]!),
    });
  }

  // Group into blocks (numbering restart = new block). A numbered line indented
  // deeper than the block's first option is a sub-list inside a description,
  // not a new option — fold it into the previous option.
  const blocks: Entry[][] = [];
  for (const e of entries) {
    let cur: Entry[] | undefined = blocks[blocks.length - 1];
    if (cur) {
      if (e.indent > cur[0]!.indent + 1) {
        const prev = cur[cur.length - 1]!;
        const sub = `${e.num}. ${e.label}${e.description ? ` ${e.description}` : ""}`;
        prev.description = prev.description ? `${prev.description} ${sub}` : sub;
        continue;
      }
      if (e.num <= cur[cur.length - 1]!.num) cur = undefined;
    }
    if (!cur) {
      cur = [];
      blocks.push(cur);
    }
    cur.push(e);
  }

  // Several blocks can be on screen (plan bullets AND the actual menu). The
  // interactive one carries the selection marker; without any marker, fall back
  // to the last block (where numbering restarted).
  const marked = blocks.filter((b) => b.some((e) => e.marked));
  const chosen = (marked.length ? marked[marked.length - 1] : blocks[blocks.length - 1]) ?? [];
  return chosen.map(({ num, label, description }) => ({ num, label, description }));
}
