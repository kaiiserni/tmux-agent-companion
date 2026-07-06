# agent-bridge

A small Bun HTTP server that bridges the live tmux fleet to the companion app.
Reads per-pane `@pane_*` tmux options (written by the tmux-agent-dashboard hooks),
activity logs, and Claude Code session transcripts; turns app requests into
`tmux` commands.

## Run

```sh
bun install
bun run bridge.ts     # listens on 0.0.0.0:8790
```

Config via env:

- `AGENT_BRIDGE_PORT` - default `8790`.
- `AGENT_BRIDGE_TOKEN` - bearer token; if unset, read from `~/.config/agent-bridge/token`.

If no token is configured, all data/action routes return `401` - set one first.

## Auth

Every route except `GET /health` requires `Authorization: Bearer <token>`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | open; `{ ok, auth }` |
| GET | `/panes` | full per-pane objects + `counts` |
| GET | `/overview/full` | raw overview.json (optional enrichment file) |
| GET | `/activity/recent?limit=` | merged tool-call feed |
| GET | `/activity?pane_id=` | one pane's tool-call log |
| GET | `/transcript?pane_id=&limit=` | Claude Code conversation (parsed JSONL) |
| GET | `/screen?pane_id=&lines=` | `capture-pane` frame |
| GET | `/prompt?pane_id=` | pending choice menu (options + descriptions) |
| GET | `/system` | CPU% / memory / load average |
| GET | `/claude-usage` | Claude subscription usage (5h + weekly), read from the poller cache |
| GET | `/term` | open; xterm.js terminal web UI (loaded by the app's WebView) |
| WS | `/terminal?pane_id=&token=&cols=&rows=` | interactive PTY attached to the pane; token via query param (a browser WS can't send a header) |
| POST | `/seen` `{pane_id}` | stamp `@pane_last_seen_at` |
| POST | `/mark-unread` `{pane_id,on}` | toggle pin |
| POST | `/clear` `{pane_id}` | clear pending flags |
| POST | `/goto` `{pane_id}` | switch tmux client to the pane |
| POST | `/send` `{pane_id,text}` | free-text reply (claude panes only) |
| POST | `/answer` `{pane_id,key}` | select a menu option / send a key |

Mutations (incl. terminal open/close) are written to an append-only audit log at
`~/.local/state/agent-bridge/audit.log`.

## Terminal mode (native dep)

`/terminal` streams a real PTY attached to the pane (via a temporary grouped tmux
session, so the phone doesn't move or resize your real client). `node-pty` **does not
spawn under Bun**, so the PTY runs in a Node sidecar (`pty-bridge.cjs`) that the bridge
spawns per connection. This adds two things to a plain Bun setup:

- `node` must be installed (the sidecar runs under Node) and `node-pty` compiled:
  `bun install` then `cd node_modules/node-pty && npx node-gyp rebuild` (needs Xcode CLT /
  build tools). Rebuild after a Node major upgrade.
- Env overrides if the binaries aren't at the defaults: `NODE_BIN` (default
  `/opt/homebrew/bin/node`), `TMUX_BIN` (default `/opt/homebrew/bin/tmux`).

## Run as a service

The bridge is OS-agnostic (Bun + tmux + `node:` builtins) - only the service
manager differs.

**macOS (launchd):** copy `agent-bridge.plist.example` to `~/Library/LaunchAgents/`,
edit the paths, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/agent-bridge.plist`.

**Linux (systemd):** copy `agent-bridge.service.example` to
`~/.config/systemd/user/agent-bridge.service`, edit the paths, then
`systemctl --user enable --now agent-bridge`.

## Optional: overview.json enrichment

If you also run a summarizer that writes `~/.local/state/agent-overview/overview.json`
(project-level `doing` / `needs_from_you` / `next_steps`), the bridge merges that
text into `/panes` and serves it at `/overview/full`. It works fine without it.
