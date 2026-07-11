import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Pane } from '../api';
import { ageLabel, Badge, Empty, ErrorBanner, paneLabel, TmuxBanner, TopBar } from '../components';
import { redact, useApp } from '../context';
import { useManualRefresh, usePanes } from '../hooks';
import type { RootNav } from '../navigation';
import { agentGlyph, statusColor, statusGlyph } from '../theme/glyphs';
import { useTheme } from '../theme/ThemeProvider';

function Tile({ pane, onPress }: { pane: Pane; onPress: () => void }) {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const priv = prefs.privacyMode;
  const preview = pane.summary || pane.prompt || pane.current_command || '';
  const meta = [pane.model, pane.account].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.tileTop}>
        <Text style={{ color: statusColor(pane.status, colors), fontFamily: font.regular, fontSize: 13 }}>{statusGlyph(pane.status)}</Text>
        <Text style={{ color: colors.accent, fontFamily: font.regular, fontSize: 13 }}>{agentGlyph(pane.agent)}</Text>
        <Text style={[styles.tileLabel, { color: colors.text, fontFamily: font.medium }]} numberOfLines={1}>
          {redact(paneLabel(pane, prefs.technicalNames), priv)}
        </Text>
      </View>
      {meta ? (
        <Text style={[styles.tileMeta, { color: colors.muted, fontFamily: font.regular }]} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      {preview ? (
        <Text style={[styles.tilePreview, { color: colors.dim, fontFamily: font.regular }]} numberOfLines={2}>
          {pane.summary ? '✦ ' : ''}
          {redact(preview, priv)}
        </Text>
      ) : null}
      <View style={styles.tileFoot}>
        <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 11 }}>{pane.status}</Text>
        {pane.permission_mode ? <Badge text={pane.permission_mode} color={colors.magenta} /> : null}
        {pane.attention ? (
          <Text style={{ color: colors.attention, fontFamily: font.medium, fontSize: 11, flexShrink: 1 }} numberOfLines={1}>▲ {pane.wait_reason ?? ''}</Text>
        ) : !priv ? (
          <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 11 }}>{ageLabel(pane.age_minutes)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function TilesScreen() {
  const { colors, font } = useTheme();
  const nav = useNavigation<RootNav>();
  const panes = usePanes();
  const refresh = useManualRefresh(panes.refetch);
  const [hideIdle, setHideIdle] = useState(true);

  const groups = useMemo(() => {
    const all = panes.data?.panes ?? [];
    const shown = hideIdle ? all.filter((p) => p.status !== 'idle' || p.attention || p.unseen) : all;
    const map = new Map<string, Pane[]>();
    for (const p of shown) {
      const arr = map.get(p.project) ?? [];
      arr.push(p);
      map.set(p.project, arr);
    }
    return [...map.entries()].map(([name, list]) => ({ name, panes: list })).sort((a, b) => a.name.localeCompare(b.name));
  }, [panes.data, hideIdle]);

  if (panes.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar
        title="Tiles"
        right={
          <Pressable onPress={() => setHideIdle((v) => !v)} hitSlop={10}>
            <Text style={{ color: hideIdle ? colors.accent : colors.muted, fontFamily: font.medium, fontSize: 12 }}>
              {hideIdle ? 'active' : 'all'}
            </Text>
          </Pressable>
        }
      />
      <ErrorBanner show={panes.isError} text="Can't reach the bridge." />
      <TmuxBanner tmux={panes.data?.tmux} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={colors.accent} />}
      >
        {groups.length === 0 ? <Empty text="No active agents." /> : null}
        {groups.map((g) => (
          <View key={g.name} style={styles.group}>
            <Text style={[styles.groupHeader, { color: colors.dim, fontFamily: font.semibold }]}>
              {g.name.toUpperCase()} · {g.panes.length}
            </Text>
            <View style={styles.grid}>
              {g.panes.map((p) => (
                <Tile key={p.pane_id} pane={p} onPress={() => nav.navigate('PaneDetail', { paneId: p.pane_id, title: p.project })} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, paddingBottom: 40 },
  group: { marginBottom: 14 },
  groupHeader: { fontSize: 11, letterSpacing: 0.6, paddingVertical: 6, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '48%',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    minHeight: 88,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { fontSize: 13, flex: 1 },
  tileMeta: { fontSize: 10, marginTop: 3 },
  tilePreview: { fontSize: 11, lineHeight: 15, marginTop: 6 },
  tileFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
});
