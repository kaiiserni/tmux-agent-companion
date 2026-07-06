import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getToken, setToken as persistToken } from '../config';
import { useApp, type Prefs } from '../context';
import { useTheme } from '../theme/ThemeProvider';

const PREF_LABELS: Record<keyof Prefs, string> = {
  privacyMode: 'Privacy / redact',
  technicalNames: 'Technical names',
  sortByActivity: 'Sort by activity',
  respondedNewestFirst: 'Responded newest first',
  soundAlerts: 'Sound alerts',
  showSystemStats: 'CPU / memory bar',
  showClaudeUsage: 'Claude usage bar',
};

export function SettingsScreen({
  initialUrl,
  onSave,
  onClose,
}: {
  initialUrl: string;
  onSave: (url: string) => void;
  onClose?: () => void;
}) {
  const { colors, font } = useTheme();
  const { prefs, togglePref } = useApp();
  const [url, setUrl] = useState(initialUrl);
  const [token, setToken] = useState('');

  useEffect(() => {
    getToken().then(setToken);
  }, []);

  const save = async () => {
    await persistToken(token);
    onSave(url);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={[styles.title, { color: colors.text, fontFamily: font.bold }]}>Settings</Text>

        <Text style={[styles.label, { color: colors.dim, fontFamily: font.medium }]}>Bridge URL</Text>
        <Text style={[styles.hint, { color: colors.muted, fontFamily: font.regular }]}>
          The agent-bridge on your dev-box, over LAN/WireGuard.
        </Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.86.5:8790"
          placeholderTextColor={colors.muted}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, fontFamily: font.regular }]}
        />

        <Text style={[styles.label, { color: colors.dim, fontFamily: font.medium }]}>Bearer token</Text>
        <Text style={[styles.hint, { color: colors.muted, fontFamily: font.regular }]}>
          Required for actions (mark, clear, goto) and reading conversations.
        </Text>
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="paste bridge token"
          placeholderTextColor={colors.muted}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, fontFamily: font.regular }]}
        />

        <Text style={[styles.label, { color: colors.dim, fontFamily: font.medium, marginTop: 20 }]}>Preferences</Text>
        {(Object.keys(PREF_LABELS) as (keyof Prefs)[]).map((key) => (
          <View key={key} style={[styles.prefRow, { borderColor: colors.border }]}>
            <Text style={[styles.prefLabel, { color: colors.text, fontFamily: font.regular }]}>{PREF_LABELS[key]}</Text>
            <Switch
              value={prefs[key]}
              onValueChange={() => togglePref(key)}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.text}
            />
          </View>
        ))}

        <Pressable
          onPress={save}
          disabled={!url.trim()}
          style={({ pressed }) => [styles.btn, { backgroundColor: colors.accent, opacity: !url.trim() ? 0.4 : pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.btnText, { fontFamily: font.semibold }]}>Save</Text>
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={{ color: colors.dim, fontFamily: font.regular }}>Close</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingTop: 60, gap: 8 },
  title: { fontSize: 24, marginBottom: 12 },
  label: { fontSize: 13, marginTop: 12 },
  hint: { fontSize: 12, lineHeight: 16, marginBottom: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 14, fontSize: 15 },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  prefLabel: { fontSize: 15 },
  btn: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 24 },
  btnText: { color: '#fff', fontSize: 16 },
  cancel: { alignItems: 'center', padding: 10 },
});
