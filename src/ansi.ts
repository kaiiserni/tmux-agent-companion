// Parses tmux `capture-pane -e` output (SGR escape sequences) into styled
// segments for the Screen tab. Mirrors the palette in server/bridge.ts'
// TERM_BOOTSTRAP `th` object so Screen and Terminal read as the same theme.
export interface AnsiSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const PALETTE: string[] = [
  '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
  '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
];

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function xterm256(n: number): string {
  if (n < 16) return PALETTE[n]!;
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    return `rgb(${CUBE_LEVELS[r]},${CUBE_LEVELS[g]},${CUBE_LEVELS[b]})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

const SGR_RE = /\x1b\[([0-9;]*)m/g;

export function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color: string | undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let lastIndex = 0;

  const push = (text: string) => {
    if (!text) return;
    segments.push({ text, color, bold, dim, italic, underline });
  };

  SGR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SGR_RE.exec(line))) {
    push(line.slice(lastIndex, m.index));
    lastIndex = SGR_RE.lastIndex;
    const codes = m[1] ? m[1].split(';').map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        color = undefined;
        bold = dim = italic = underline = false;
      } else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 3) italic = true;
      else if (c === 4) underline = true;
      else if (c === 22) { bold = false; dim = false; }
      else if (c === 23) italic = false;
      else if (c === 24) underline = false;
      else if (c >= 30 && c <= 37) color = PALETTE[c - 30];
      else if (c === 39) color = undefined;
      else if (c >= 90 && c <= 97) color = PALETTE[8 + (c - 90)];
      else if (c === 38) {
        if (codes[i + 1] === 5 && codes[i + 2] != null) { color = xterm256(codes[i + 2]!); i += 2; }
        else if (codes[i + 1] === 2 && codes[i + 4] != null) { color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
      }
      // background (40-49 / 48) intentionally ignored - the Screen tab has one fixed dark bg
    }
  }
  push(line.slice(lastIndex));
  return segments;
}

export function visibleLength(line: string): number {
  return line.replace(/\x1b\[[0-9;]*m/g, '').length;
}
