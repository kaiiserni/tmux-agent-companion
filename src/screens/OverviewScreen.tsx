import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Pane } from '../api';
import { ageLabel, Empty, ErrorBanner, TopBar } from '../components';
import { redact, useApp } from '../context';
import { useManualRefresh, useOverviewFull, usePanes } from '../hooks';
import type { RootNav } from '../navigation';
import { agentGlyph, paneProviderMeta, statusColor, statusGlyph } from '../theme/glyphs';
import { useTheme } from '../theme/ThemeProvider';

function ago(updatedAt: number): string {
  if (!updatedAt) return '';
  const mins = Math.max(0, Math.round(Date.now() / 1000 - updatedAt) / 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function OverviewScreen() {
  const { colors, font } = useTheme();
  const nav = useNavigation<RootNav>();
  const { prefs } = useApp();
  const priv = prefs.privacyMode;
  const q = useOverviewFull();
  const refresh = useManualRefresh(q.refetch);
  const ov = q.data;
  const [tldrOpen, setTldrOpen] = useState(false);
  // overview.json ships an empty panes[] per project, so pair the live panes to a
  // project by name instead - that's what makes a block tappable.
  const panesQ = usePanes();
  const panesByProject = useMemo(() => {
    const m = new Map<string, Pane[]>();
    for (const p of panesQ.data?.panes ?? []) {
      const arr = m.get(p.project) ?? [];
      arr.push(p);
      m.set(p.project, arr);
    }
    return m;
  }, [panesQ.data]);

  if (q.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Overview" />
      <ErrorBanner show={q.isError} text="Can't reach the bridge." />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={colors.accent} />}
      >
        {ov ? (
          <Text style={[styles.status, { color: colors.muted, fontFamily: font.regular }]}>
            Updated {ago(ov.updated_at)} · {ov.projects.length} projects · {ov.idle.length} idle
          </Text>
        ) : null}

        {ov && ov.tldr.length > 0 ? (
          <View style={styles.tldr}>
            <Pressable
              onPress={() => setTldrOpen((v) => !v)}
              style={({ pressed }) => [styles.tldrHead, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: colors.dim, fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6 }}>
                TL;DR · {ov.tldr.length}
              </Text>
              <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 12 }}>{tldrOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {tldrOpen
              ? ov.tldr.map((t, i) => (
                  <Text key={i} style={[styles.tldrLine, { color: colors.text, fontFamily: font.regular }]}>
                    • {redact(t, priv)}
                  </Text>
                ))
              : null}
          </View>
        ) : null}

        {ov?.projects.map((p) => (
          <View key={p.name} style={[styles.block, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={styles.blockHead}>
              <Text style={[styles.projName, { color: colors.text, fontFamily: font.bold }]}>▍{p.name}</Text>
              {p.attention ? <Text style={{ color: colors.attention, fontFamily: font.medium, fontSize: 12 }}>⚠ needs you</Text> : null}
            </View>
            {(panesByProject.get(p.name) ?? []).map((pn) => (
              <Pressable
                key={pn.pane_id}
                onPress={() => nav.navigate('PaneDetail', { paneId: pn.pane_id, title: p.name })}
                style={({ pressed }) => [styles.paneRow, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={{ color: statusColor(pn.status, colors), fontFamily: font.regular, fontSize: 12 }}>
                  {statusGlyph(pn.status)}
                </Text>
                <Text style={{ color: colors.accent, fontFamily: font.regular, fontSize: 12 }}>{agentGlyph(pn.agent)}</Text>
                <Text style={[styles.paneTarget, { color: colors.text, fontFamily: font.regular }]} numberOfLines={1}>
                  {paneProviderMeta(pn) || pn.target}
                </Text>
                {!priv ? (
                  <Text style={[styles.paneAge, { color: colors.muted, fontFamily: font.regular }]}>{ageLabel(pn.age_minutes)}</Text>
                ) : null}
                <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 13 }}>›</Text>
              </Pressable>
            ))}
            {p.doing ? (
              <Text style={[styles.doing, { color: colors.dim, fontFamily: font.regular }]}>{redact(p.doing, priv)}</Text>
            ) : null}
            {p.needs_from_you && p.needs_from_you !== 'null' ? (
              <Text style={[styles.needs, { color: colors.attention, fontFamily: font.medium }]}>⚠ {redact(p.needs_from_you, priv)}</Text>
            ) : null}
            {p.next_steps?.map((s, i) => (
              <Text key={i} style={[styles.next, { color: colors.cyan, fontFamily: font.regular }]}>→ {redact(s, priv)}</Text>
            ))}
            {p.active_md?.map((m, i) => (
              <Text key={i} style={[styles.activeMd, { color: colors.muted, fontFamily: font.regular }]}>{redact(m, priv)}</Text>
            ))}
          </View>
        ))}

        {ov && ov.idle.length > 0 ? (
          <View style={styles.idleBlock}>
            <Text style={[styles.idleHeader, { color: colors.dim, fontFamily: font.semibold }]}>IDLE · {ov.idle.length}</Text>
            {ov.idle.map((i) => (
              <Pressable
                key={i.pane_id}
                onPress={() => nav.navigate('PaneDetail', { paneId: i.pane_id, title: i.project })}
                style={({ pressed }) => [styles.idleRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.idleLine, { color: colors.muted, fontFamily: font.regular }]} numberOfLines={1}>
                  {i.target} · {i.project} - {redact(i.task, priv)}
                </Text>
                <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 13 }}>›</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {ov && ov.projects.length === 0 ? <Empty text="No overview yet." /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, paddingBottom: 40 },
  status: { fontSize: 12, paddingHorizontal: 4, paddingBottom: 8 },
  tldr: { marginBottom: 12, paddingHorizontal: 4 },
  tldrHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  tldrLine: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  block: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 8 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projName: { fontSize: 16 },
  doing: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  needs: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  next: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  activeMd: { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  paneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  paneTarget: { fontSize: 12, flex: 1 },
  paneAge: { fontSize: 11 },
  idleBlock: { marginTop: 8 },
  idleHeader: { fontSize: 11, letterSpacing: 0.6, paddingVertical: 6, paddingHorizontal: 4 },
  idleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingVertical: 3 },
  idleLine: { fontSize: 12, lineHeight: 17, flex: 1 },
});
