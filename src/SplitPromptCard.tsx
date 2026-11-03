import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SplitPrompt, SplitReply } from './api';
import { redact, useApp } from './context';
import { hapticSelect, hapticSuccess, hapticWarn } from './haptics';
import { usePaneActions } from './hooks';
import { useTheme } from './theme/ThemeProvider';

// Prompt waiting in the shell/CLI split next to the agent (sudo, y/n, wizard).
export function SplitPromptCard({ paneId, split, onAnswered }: { paneId: string; split: SplitPrompt; onAnswered: () => void }) {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const priv = prefs.privacyMode;
  const { splitAnswer } = usePaneActions();
  const [text, setText] = useState('');
  const busy = splitAnswer.isPending;

  const reply = (r: SplitReply) => {
    hapticSelect();
    splitAnswer.mutate(
      { id: paneId, target: split.pane_id, reply: r },
      {
        onSuccess: () => {
          hapticSuccess();
          if ('text' in r) setText('');
          onAnswered();
        },
      },
    );
  };

  const interrupt = () =>
    Alert.alert('Interrupt', `Sends Ctrl+C to ${split.target} (${split.command}).`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Interrupt',
        style: 'destructive',
        onPress: () => {
          hapticWarn();
          reply({ key: 'ctrl-c' });
        },
      },
    ]);

  const btn = (label: string, color: string, onPress: () => void) => (
    <Pressable
      key={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { borderColor: color, opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color, fontFamily: font.medium, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  const option = (key: string, label: string, prefix: string, active: boolean, description?: string) => (
    <Pressable
      key={key}
      disabled={busy}
      onPress={() => reply({ key })}
      style={({ pressed }) => [
        styles.option,
        { borderColor: active ? colors.accent : colors.border, opacity: busy ? 0.4 : pressed ? 0.5 : 1 },
      ]}
    >
      <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 13 }}>
        <Text style={{ color: colors.accent }}>{prefix}</Text> {redact(label, priv)}
      </Text>
      {description ? (
        <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 11, marginTop: 3 }}>{redact(description, priv)}</Text>
      ) : null}
    </Pressable>
  );

  // Last screen lines give context the one-line question lacks (what sudo is for, etc.).
  const tail = split.tail
    .split('\n')
    .filter((l) => l.trim() && !l.includes(split.question))
    .slice(-4)
    .join('\n');

  return (
    <View style={[styles.card, { borderColor: colors.waiting, backgroundColor: colors.surfaceAlt }]}>
      <Text style={{ color: colors.waiting, fontFamily: font.semibold, fontSize: 12 }}>
        ⇄ split {split.target} · {split.command}
      </Text>
      {tail ? (
        <Text style={[styles.tail, { color: colors.dim, fontFamily: font.regular }]} numberOfLines={4}>
          {redact(tail, priv)}
        </Text>
      ) : null}
      <Text style={[styles.question, { color: colors.text, fontFamily: font.semibold }]}>{redact(split.question, priv)}</Text>

      {split.kind === 'menu' || split.kind === 'select' ? (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {split.options.map((o, i) =>
            split.kind === 'menu'
              ? option(String(o.num), o.label, `${o.num}.`, false, o.description)
              : option(`select:${i}`, o.label, i === split.selected ? '❯' : ' ', i === split.selected),
          )}
        </ScrollView>
      ) : null}

      {split.kind === 'input' ? (
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="answer…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            submitBehavior="submit"
            onSubmitEditing={() => text.trim() && reply({ text })}
            style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, fontFamily: font.regular }]}
          />
          {btn('Send', colors.accent, () => text.trim() && reply({ text }))}
        </View>
      ) : null}

      {split.kind === 'password' ? (
        <Text style={[styles.hint, { color: colors.muted, fontFamily: font.regular }]}>Type the password in the terminal.</Text>
      ) : null}

      <View style={styles.row}>
        {split.kind === 'yesno' ? [btn('Yes', colors.running, () => reply({ key: 'y' })), btn('No', colors.attention, () => reply({ key: 'n' }))] : null}
        {split.kind === 'enter' || split.kind === 'input' ? btn(split.kind === 'input' ? 'Enter (default)' : 'Enter', colors.accent, () => reply({ key: 'enter' })) : null}
        {split.kind === 'menu' || split.kind === 'select' ? btn('Esc', colors.muted, () => reply({ key: 'esc' })) : null}
        {btn('⌃C', colors.attention, interrupt)}
      </View>

      {splitAnswer.isError ? (
        <Text style={[styles.hint, { color: colors.waiting, fontFamily: font.regular }]}>Prompt changed or is gone. Pull to refresh.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginHorizontal: 8, marginBottom: 6, gap: 8 },
  tail: { fontSize: 11, lineHeight: 15 },
  question: { fontSize: 13, lineHeight: 18 },
  scroll: { maxHeight: 260 },
  option: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  hint: { fontSize: 12, lineHeight: 16 },
});
