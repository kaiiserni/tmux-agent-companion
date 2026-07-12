import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ClaudeUsage, Pane, SystemStats, UsageLimit } from './api';
import { redact, useApp } from './context';
import { hapticTap } from './haptics';
import { useClaudeUsage, useSystem } from './hooks';
import { agentGlyph, statusColor, statusGlyph } from './theme/glyphs';
import { useTheme } from './theme/ThemeProvider';

export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  const { colors, font } = useTheme();
  return (
    <View style={[styles.topbar, { borderColor: colors.border, backgroundColor: colors.deepest }]}>
      <View style={styles.topLeft}>
        <Text style={[styles.topPrompt, { color: colors.accent, fontFamily: font.bold }]}>❯</Text>
        <Text style={[styles.topTitle, { color: colors.text, fontFamily: font.bold }]}>{title}</Text>
      </View>
      <View style={styles.topRight}>{right}</View>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const { colors, font } = useTheme();
  return <Text style={[styles.empty, { color: colors.muted, fontFamily: font.regular }]}>{text}</Text>;
}

export function ErrorBanner({ show, text }: { show: boolean; text: string }) {
  const { colors, font } = useTheme();
  if (!show) return null;
  return <Text style={[styles.error, { color: colors.attention, fontFamily: font.regular }]}>{text}</Text>;
}

// Bridge reachable but no tmux server - distinct from an idle fleet. Shared by tabs.
export function TmuxBanner({ tmux }: { tmux?: boolean }) {
  const { colors, font } = useTheme();
  if (tmux !== false) return null;
  return <Text style={[styles.error, { color: colors.waiting, fontFamily: font.regular }]}>No tmux server on the dev-box.</Text>;
}

// tmux-status-bar style resource strip: mono █░ bars, threshold colors. Each half
// is gated by its Settings toggle and only polls the bridge when shown.
export function StatsStrip() {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const sys = useSystem(prefs.showSystemStats);
  const usage = useClaudeUsage(prefs.showClaudeUsage);
  const [usageOpen, setUsageOpen] = useState(false);
  const [sysOpen, setSysOpen] = useState(false);
  if (!prefs.showSystemStats && !prefs.showClaudeUsage) return null;
  if (!sys.data && !usage.data) return null;

  const barStr = (p: number) => {
    const fill = Math.max(0, Math.min(8, Math.round(p / 12.5)));
    return '█'.repeat(fill) + '░'.repeat(8 - fill);
  };
  const col = (p: number) => (p >= 85 ? colors.attention : p >= 60 ? colors.waiting : colors.running);
  // Monospace + fixed-width fields → labels, bars and percentages line up across rows.
  const metric = (label: string, p: number | null | undefined) =>
    p == null ? null : (
      <Text style={{ fontFamily: font.regular, fontSize: 12 }}>
        <Text style={{ color: colors.muted }}>{label.padEnd(3)} </Text>
        <Text style={{ color: col(p) }}>{barStr(p)}</Text>
        <Text style={{ color: colors.dim }}> {`${Math.round(p)}%`.padStart(4)}</Text>
      </Text>
    );

  return (
    <View style={[styles.stats, { borderColor: colors.border, backgroundColor: colors.deepest }]}>
      {prefs.showSystemStats && sys.data ? (
        <>
          <Pressable
            onPress={() => {
              hapticTap();
              setSysOpen(true);
            }}
            style={({ pressed }) => [styles.statsRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            {metric('CPU', sys.data.cpu)}
            {metric('MEM', sys.data.mem.percent)}
            <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 12, flex: 1 }}>
              ↑{sys.data.load[0]?.toFixed(1)}
            </Text>
            <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 13 }}>›</Text>
          </Pressable>
          <SystemModal visible={sysOpen} onClose={() => setSysOpen(false)} sys={sys.data} />
        </>
      ) : null}
      {prefs.showClaudeUsage && usage.data ? (
        <>
          <Pressable
            onPress={() => {
              hapticTap();
              setUsageOpen(true);
            }}
            style={({ pressed }) => [styles.statsRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 12 }}>USG</Text>
            {/* wrap per entry, so a 5th tool never breaks mid-percentage */}
            <View style={styles.usageEntries}>
              {usage.data.accounts.map((a) => {
                // grok has no 5h window - show only the windows a tool actually reports,
                // so it reads "G 0%" instead of "G -/0%".
                const windows = [a.session, a.weekly].filter(
                  (l): l is UsageLimit => l != null && l.percent != null,
                );
                return (
                  <Text key={a.key} style={{ fontFamily: font.regular, fontSize: 12 }}>
                    <Text style={{ color: colors.dim }}>{a.label} </Text>
                    {windows.length === 0 ? (
                      <Text style={{ color: colors.muted }}>-</Text>
                    ) : (
                      windows.map((l, i) => (
                        <Text key={l.kind}>
                          {i > 0 ? <Text style={{ color: colors.muted }}>/</Text> : null}
                          <Text style={{ color: sevColor(l, colors) }}>{pctText(l)}</Text>
                        </Text>
                      ))
                    )}
                  </Text>
                );
              })}
            </View>
            <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 13 }}>›</Text>
          </Pressable>
          <UsageModal visible={usageOpen} onClose={() => setUsageOpen(false)} usage={usage.data} />
        </>
      ) : null}
    </View>
  );
}

// severity comes straight from the usage poller (normal/warning/critical).
function sevColor(l: UsageLimit | null | undefined, colors: ReturnType<typeof useTheme>['colors']): string {
  if (!l || l.percent == null) return colors.muted;
  if (l.severity === 'critical') return colors.attention;
  if (l.severity === 'warning') return colors.waiting;
  return colors.running;
}

const pctText = (l: UsageLimit | null | undefined) => (l?.percent == null ? '-' : `${Math.round(l.percent)}%`);

function resetsLabel(l: UsageLimit): string {
  return l.resets_at ? resetsIn(l.resets_at) : (l.resets_text ?? '');
}

function resetsIn(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'resetting';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `resets in ${h}h ${mins % 60}m`;
  return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function limitLabel(l: UsageLimit): string {
  if (l.kind === 'session') return '5h session';
  if (l.kind === 'weekly_all') return '7d all';
  if (l.kind === 'weekly_scoped') return `7d ${l.model ?? 'scoped'}`;
  return l.kind;
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)}G`;

function upFor(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function SystemModal({ visible, onClose, sys }: { visible: boolean; onClose: () => void; sys: SystemStats }) {
  const { colors, font } = useTheme();
  const col = (p: number) => (p >= 85 ? colors.attention : p >= 60 ? colors.waiting : colors.running);
  const bar = (p: number, width = 10) => {
    const fill = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
    return '█'.repeat(fill) + '░'.repeat(width - fill);
  };
  const row = (label: string, p: number, right: string) => (
    <View style={styles.usageLine}>
      <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 11, width: 84 }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: col(p), fontFamily: font.regular, fontSize: 11 }}>{bar(p)}</Text>
      <Text style={{ color: col(p), fontFamily: font.medium, fontSize: 11, width: 38, textAlign: 'right' }}>{`${Math.round(p)}%`}</Text>
      <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 10, flex: 1, textAlign: 'right' }} numberOfLines={1}>
        {right}
      </Text>
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.usageBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.usageSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.usageHead}>
            <Text style={{ color: colors.text, fontFamily: font.bold, fontSize: 15 }}>System</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            <View style={styles.usageAcct}>
              <Text style={{ color: colors.accent, fontFamily: font.semibold, fontSize: 12 }}>
                CPU · {sys.cores.length} cores · load {sys.load.map((l) => l.toFixed(1)).join(' ')}
              </Text>
              {row('total', sys.cpu, `up ${upFor(sys.uptime)}`)}
              {sys.cores.map((c, i) => row(`core ${i}`, c, ''))}
            </View>

            <View style={styles.usageAcct}>
              <Text style={{ color: colors.accent, fontFamily: font.semibold, fontSize: 12 }}>Memory</Text>
              {row('used', sys.mem.percent, `${gb(sys.mem.used)} / ${gb(sys.mem.total)}`)}
              {sys.mem.cached > 0 ? (
                <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 10, marginTop: 4 }}>
                  cached {gb(sys.mem.cached)} · available {gb(sys.mem.available)}
                </Text>
              ) : null}
              {sys.swap ? row('swap', sys.swap.percent, `${gb(sys.swap.used)} / ${gb(sys.swap.total)}`) : null}
            </View>

            {sys.top.length > 0 ? (
              <View style={styles.usageAcct}>
                <Text style={{ color: colors.accent, fontFamily: font.semibold, fontSize: 12 }}>Top processes</Text>
                {sys.top.map((p, i) => (
                  <View key={`${p.name}-${i}`} style={styles.usageLine}>
                    <Text style={{ color: colors.text, fontFamily: font.regular, fontSize: 11, flex: 1 }} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={{ color: col(p.cpu), fontFamily: font.medium, fontSize: 11, width: 52, textAlign: 'right' }}>
                      {p.cpu.toFixed(1)}%
                    </Text>
                    <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 10, width: 56, textAlign: 'right' }}>
                      {p.mem.toFixed(1)}% mem
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UsageModal({ visible, onClose, usage }: { visible: boolean; onClose: () => void; usage: ClaudeUsage }) {
  const { colors, font } = useTheme();
  const bar = (p: number) => {
    const fill = Math.max(0, Math.min(10, Math.round(p / 10)));
    return '█'.repeat(fill) + '░'.repeat(10 - fill);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.usageBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.usageSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.usageHead}>
            <Text style={{ color: colors.text, fontFamily: font.bold, fontSize: 15 }}>Agent usage</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 16 }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }}>
            {usage.accounts.map((a) => (
              <View key={a.key} style={styles.usageAcct}>
                <Text style={{ color: colors.accent, fontFamily: font.semibold, fontSize: 12 }}>
                  {a.label} · {a.name}
                  {a.plan ? ` · ${a.plan}` : ''}
                </Text>
                {a.limits.length === 0 ? (
                  <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>no data</Text>
                ) : (
                  a.limits.map((l) => (
                    <View key={l.kind} style={styles.usageLine}>
                      <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 11, width: 84 }} numberOfLines={1}>
                        {limitLabel(l)}
                      </Text>
                      <Text style={{ color: sevColor(l, colors), fontFamily: font.regular, fontSize: 11 }}>
                        {l.percent == null ? '' : bar(l.percent)}
                      </Text>
                      <Text style={{ color: sevColor(l, colors), fontFamily: font.medium, fontSize: 11, width: 38, textAlign: 'right' }}>
                        {pctText(l)}
                      </Text>
                      <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 10, flex: 1, textAlign: 'right' }} numberOfLines={1}>
                        {resetsLabel(l)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  const { font } = useTheme();
  return (
    <Text style={[styles.badge, { color, borderColor: color, fontFamily: font.medium }]}>{text}</Text>
  );
}

export function ageLabel(mins: number | null): string {
  if (mins === null) return '';
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Friendly vs technical label (mirror dashboard `n` toggle, loosely).
export function paneLabel(p: Pane, technical: boolean): string {
  if (technical) {
    const branch = p.worktree_branch || p.window_name;
    return branch ? `${p.project} ${branch}` : p.project || p.target;
  }
  return p.pane_name || p.project || p.target;
}

// A pane reason string per the dashboard section rules.
export function paneReason(p: Pane): string {
  if (p.wait_reason) return p.wait_reason;
  if (p.prompt) return p.prompt;
  if (p.current_command && p.current_command !== 'claude') return p.current_command;
  return p.summary || p.doing || '';
}

export function PaneRow({ pane, onPress }: { pane: Pane; onPress: () => void }) {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const priv = prefs.privacyMode;
  const reason = redact(paneReason(pane), priv);
  const label = redact(paneLabel(pane, prefs.technicalNames), priv);
  const meta = [pane.model, pane.account].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: pane.attention ? colors.attention : colors.border,
          borderLeftWidth: pane.attention ? 3 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text style={[styles.statusIcon, { color: statusColor(pane.status, colors), fontFamily: font.regular }]}>
        {statusGlyph(pane.status)}
      </Text>
      <Text style={[styles.agentIcon, { color: colors.accent, fontFamily: font.regular }]}>{agentGlyph(pane.agent)}</Text>
      <View style={styles.rowMid}>
        <Text style={[styles.rowLabel, { color: colors.text, fontFamily: font.medium }]} numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text style={[styles.rowMeta, { color: colors.muted, fontFamily: font.regular }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {reason ? (
          <Text style={[styles.rowReason, { color: colors.dim, fontFamily: font.regular }]} numberOfLines={1}>
            {reason}
          </Text>
        ) : null}
      </View>
      {pane.permission_mode ? <Badge text={pane.permission_mode} color={colors.magenta} /> : null}
      {!priv ? (
        <Text style={[styles.age, { color: colors.muted, fontFamily: font.regular }]}>{ageLabel(pane.age_minutes)}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  topPrompt: { fontSize: 20 },
  topTitle: { fontSize: 22, letterSpacing: 0.3 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  error: { fontSize: 13, paddingHorizontal: 16, paddingTop: 10 },
  stats: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, gap: 6, marginHorizontal: 12, marginTop: 14, marginBottom: 10 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  usageEntries: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 3 },
  usageBackdrop: { flex: 1, backgroundColor: '#000000aa', alignItems: 'center', justifyContent: 'center', padding: 20 },
  usageSheet: { width: '100%', maxWidth: 420, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  usageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  usageAcct: { marginBottom: 14 },
  usageLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  badge: {
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  statusIcon: { fontSize: 14, width: 16, textAlign: 'center' },
  agentIcon: { fontSize: 13, width: 14, textAlign: 'center' },
  rowMid: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15 },
  rowMeta: { fontSize: 10, marginTop: 1 },
  rowReason: { fontSize: 12, marginTop: 2 },
  age: { fontSize: 12 },
});
