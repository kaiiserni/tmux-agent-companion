// PTY sidecar (runs under Node — node-pty fails under Bun). Spawned by the Bun bridge
// per terminal WebSocket. Attaches a real PTY to a (grouped) tmux session and bridges
// it to the parent over stdio:
//   - PTY output  → this process stdout → bridge → WebSocket
//   - bridge stdin → framed control: [type:1][len:4 BE][payload]
//       type 0 = input  → pty.write(payload)
//       type 1 = resize → pty.resize(cols, rows)  (payload = "cols,rows")
const pty = require('node-pty');

const [target, cols0, rows0] = process.argv.slice(2);
const TMUX = process.env.TMUX_BIN || 'tmux';

// Grouped sessions share windows: our size resizes the user's real window too.
// Clamp so a degenerate client viewport can never crush it (seen: 53x2).
const clampCols = (c) => Math.max(20, Number(c) || 80);
const clampRows = (r) => Math.max(8, Number(r) || 24);

const term = pty.spawn(TMUX, ['-u', 'attach', '-t', target], {
  name: 'xterm-256color',
  cols: clampCols(cols0),
  rows: clampRows(rows0),
  cwd: process.env.HOME,
  env: process.env,
});

term.onData((d) => process.stdout.write(d));
term.onExit(() => process.exit(0));

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 5) {
    const type = buf[0];
    const len = buf.readUInt32BE(1);
    if (buf.length < 5 + len) break;
    const payload = buf.subarray(5, 5 + len);
    buf = buf.subarray(5 + len);
    if (type === 0) {
      term.write(payload.toString('utf8'));
    } else if (type === 1) {
      const [c, r] = payload.toString('utf8').split(',');
      try {
        term.resize(clampCols(c), clampRows(r));
      } catch {
        /* pty gone */
      }
    }
  }
});

const bye = () => {
  try {
    term.kill();
  } catch {
    /* already gone */
  }
  process.exit(0);
};
process.stdin.on('end', bye);
process.on('SIGTERM', bye);
