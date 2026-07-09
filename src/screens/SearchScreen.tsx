import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Empty, ErrorBanner, PaneRow, paneLabel, paneReason, TmuxBanner, TopBar } from '../components';
import { useApp } from '../context';
import { hapticTap } from '../haptics';
import { usePanes } from '../hooks';
import type { RootNav } from '../navigation';
import { useTheme } from '../theme/ThemeProvider';

export function SearchScreen() {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const nav = useNavigation<RootNav>();
  const panes = usePanes();
  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const results = useMemo(() => {
    const all = [...(panes.data?.panes ?? [])];
    // urgency-first: pending panes (priority set) before the rest, then recency.
    all.sort((a, b) => {
      const pa = a.priority ?? 99;
      const pb = b.priority ?? 99;
      if (pa !== pb) return pa - pb;
      const age = (a.age_minutes ?? 1e9) - (b.age_minutes ?? 1e9);
      return newestFirst ? age : -age;
    });
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) =>
      `${paneLabel(p, prefs.technicalNames)} ${p.project} ${p.agent} ${paneReason(p)}`.toLowerCase().includes(q),
    );
  }, [panes.data, query, prefs.technicalNames, newestFirst]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Search" />
      <ErrorBanner show={panes.isError} text="Can't reach the bridge." />
      <TmuxBanner tmux={panes.data?.tmux} />
      <View style={styles.filterRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          placeholder="filter agents…"
          placeholderTextColor={colors.muted}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, fontFamily: font.regular }]}
        />
        <Pressable
          onPress={() => {
            hapticTap();
            setNewestFirst((v) => !v);
          }}
          hitSlop={8}
          style={[styles.sortBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={{ color: colors.dim, fontFamily: font.medium, fontSize: 13 }}>{newestFirst ? '↓ new' : '↑ old'}</Text>
        </Pressable>
      </View>
      <FlatList
        data={results}
        keyExtractor={(p) => p.pane_id}
        renderItem={({ item }) => (
          <PaneRow pane={item} onPress={() => nav.navigate('PaneDetail', { paneId: item.pane_id, title: item.project })} />
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        ListEmptyComponent={<Empty text={query ? 'No matches.' : 'No agents.'} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12 },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 15 },
  sortBtn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12 },
  list: { paddingHorizontal: 12, paddingBottom: 40 },
});
