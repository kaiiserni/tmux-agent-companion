import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Empty, ErrorBanner, PaneRow, paneLabel, paneReason, TmuxBanner, TopBar } from '../components';
import { useApp } from '../context';
import { usePanes } from '../hooks';
import type { RootNav } from '../navigation';
import { useTheme } from '../theme/ThemeProvider';

export function SearchScreen() {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const nav = useNavigation<RootNav>();
  const panes = usePanes();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const all = [...(panes.data?.panes ?? [])];
    // urgency-first: pending panes (priority set) before the rest, then recency.
    all.sort((a, b) => {
      const pa = a.priority ?? 99;
      const pb = b.priority ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.age_minutes ?? 1e9) - (b.age_minutes ?? 1e9);
    });
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) =>
      `${paneLabel(p, prefs.technicalNames)} ${p.project} ${p.agent} ${paneReason(p)}`.toLowerCase().includes(q),
    );
  }, [panes.data, query, prefs.technicalNames]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Search" />
      <ErrorBanner show={panes.isError} text="Can't reach the bridge." />
      <TmuxBanner tmux={panes.data?.tmux} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="filter agents…"
        placeholderTextColor={colors.muted}
        style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, fontFamily: font.regular }]}
      />
      <FlatList
        data={results}
        keyExtractor={(p) => p.pane_id}
        renderItem={({ item }) => (
          <PaneRow pane={item} onPress={() => nav.navigate('PaneDetail', { paneId: item.pane_id, title: item.project })} />
        )}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text={query ? 'No matches.' : 'No agents.'} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { margin: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 15 },
  list: { paddingHorizontal: 12, paddingBottom: 40 },
});
