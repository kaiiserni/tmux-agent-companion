import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import type { Counts } from '../api';
import { Empty, ErrorBanner, PaneRow, StatsStrip, TmuxBanner, TopBar } from '../components';
import { useApp } from '../context';
import { useManualRefresh, usePanes, useRecentActivity } from '../hooks';
import type { RootNav } from '../navigation';
import { buildSummarySections } from '../sections';
import { statusGlyph } from '../theme/glyphs';
import { useTheme } from '../theme/ThemeProvider';

const COUNTER_ORDER: { key: keyof Counts; status: string; label: string }[] = [
  { key: 'all', status: '', label: '≡' },
  { key: 'running', status: 'running', label: '' },
  { key: 'background', status: 'background', label: '' },
  { key: 'waiting', status: 'waiting', label: '' },
  { key: 'idle', status: 'idle', label: '' },
  { key: 'error', status: 'error', label: '' },
];

function Counters({ counts }: { counts: Counts }) {
  const { colors, font } = useTheme();
  return (
    <View style={[styles.counters, { borderColor: colors.border }]}>
      {COUNTER_ORDER.map((c) => (
        <View key={c.key} style={styles.counter}>
          <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 14 }}>
            {c.status ? statusGlyph(c.status) : c.label}
          </Text>
          <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>{counts[c.key]}</Text>
        </View>
      ))}
      {counts.attention > 0 ? (
        <View style={styles.counter}>
          <Text style={{ color: colors.attention, fontFamily: font.semibold, fontSize: 14 }}>▲ {counts.attention}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SummaryScreen() {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const nav = useNavigation<RootNav>();
  const panes = usePanes();
  const activity = useRecentActivity();
  const refresh = useManualRefresh(panes.refetch);

  const sections = panes.data ? buildSummarySections(panes.data.panes, prefs) : [];

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
        title="Agents"
        right={
          <Pressable onPress={() => nav.navigate('Settings')} hitSlop={12}>
            <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 20 }}>⚙</Text>
          </Pressable>
        }
      />
      <ErrorBanner show={panes.isError} text="Can't reach the bridge - check VPN and settings." />
      <TmuxBanner tmux={panes.data?.tmux} />
      {panes.data ? <Counters counts={panes.data.counts} /> : null}
      <StatsStrip />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.pane_id}
        renderItem={({ item }) => (
          <PaneRow pane={item} onPress={() => nav.navigate('PaneDetail', { paneId: item.pane_id, title: item.project })} />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.dim, backgroundColor: colors.bg, fontFamily: font.semibold }]}>
            {section.title.toUpperCase()} · {section.data.length}
          </Text>
        )}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={<Empty text="Nothing running right now." />}
        ListFooterComponent={
          activity.data && activity.data.activity.length > 0 ? (
            <View style={styles.activity}>
              <Text style={[styles.sectionHeader, { color: colors.dim, fontFamily: font.semibold }]}>ACTIVITY</Text>
              {activity.data.activity.slice(0, 20).map((a, i) => (
                <Text key={i} style={[styles.activityLine, { color: colors.muted, fontFamily: font.regular }]} numberOfLines={1}>
                  <Text style={{ color: colors.dim }}>{a.time}</Text> <Text style={{ color: colors.cyan }}>{a.tool}</Text> {a.label}
                </Text>
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  counters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  list: { padding: 12, paddingBottom: 40 },
  sectionHeader: { fontSize: 11, letterSpacing: 0.6, paddingVertical: 8, paddingHorizontal: 4 },
  activity: { marginTop: 12 },
  activityLine: { fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
});
