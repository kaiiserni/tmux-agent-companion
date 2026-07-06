import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Pane } from './api';
import { redact, useApp } from './context';
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
        <View style={styles.statsRow}>
          {metric('CPU', sys.data.cpu)}
          {metric('MEM', sys.data.mem.percent)}
          <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 12 }}>↑{sys.data.load[0]?.toFixed(1)}</Text>
        </View>
      ) : null}
      {prefs.showClaudeUsage && usage.data ? (
        <View style={styles.statsRow}>
          {metric('5H', usage.data.five_hour?.utilization)}
          {metric('7D', usage.data.seven_day?.utilization)}
        </View>
      ) : null}
    </View>
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
  rowReason: { fontSize: 12, marginTop: 2 },
  age: { fontSize: 12 },
});
