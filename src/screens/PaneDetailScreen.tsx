import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Pane, TranscriptEntry } from '../api';
import { ageLabel, Badge } from '../components';
import { redact, useApp } from '../context';
import { hapticSelect, hapticSuccess, hapticTap, hapticWarn } from '../haptics';
import { LIVE_POLL, useActivity, usePaneActions, usePanes, usePrompt, useScreen, useTranscript } from '../hooks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Markdown } from '../markdown';
import { useKeyboardHeight } from '../useKeyboardHeight';
import type { RootStackParamList } from '../navigation';
import { agentGlyph, statusColor, statusGlyph } from '../theme/glyphs';
import { useTheme } from '../theme/ThemeProvider';

function toolSummary(e: TranscriptEntry): string {
  const input = (e.input ?? {}) as Record<string, unknown>;
  if (e.tool === 'Bash') return String(input.command ?? '');
  if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Read') return String(input.file_path ?? '');
  if (e.tool === 'ExitPlanMode') return String(input.plan ?? '');
  const keys = Object.keys(input);
  return keys.length ? `${keys[0]}: ${String(input[keys[0]!]).slice(0, 80)}` : '';
}

function ToolBlock({ entry, priv, time, onCopy }: { entry: TranscriptEntry; priv: boolean; time?: string; onCopy: (t: string) => void }) {
  const { colors, font } = useTheme();
  const [open, setOpen] = useState(false);
  const full = toolSummary(entry);
  const long = full.length > 100 || full.includes('\n');
  return (
    <Pressable
      onPress={() => long && setOpen((v) => !v)}
      onLongPress={() => onCopy(full || `⚙ ${entry.tool}`)}
      style={[styles.toolChip, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
    >
      <Text style={{ color: colors.magenta, fontFamily: font.medium, fontSize: 11 }}>
        ⚙ {entry.tool}
        {time ? <Text style={{ color: colors.muted }}>{'  '}{time}</Text> : null}
        {long ? <Text style={{ color: colors.muted }}>{open ? '  ▾' : '  ▸'}</Text> : null}
      </Text>
      {full ? (
        <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 11, lineHeight: 15 }} numberOfLines={open ? undefined : 2}>
          {redact(full, priv)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function fmtTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Turn({ entry, priv, onCopy }: { entry: TranscriptEntry; priv: boolean; onCopy: (t: string) => void }) {
  const { colors, font } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const time = fmtTime(entry.ts);
  if (entry.role === 'tool_use') return <ToolBlock entry={entry} priv={priv} time={time} onCopy={onCopy} />;
  const isUser = entry.role === 'user';
  const text = redact(entry.text ?? '', priv).replace(/\n{3,}/g, '\n\n').trim();
  const long = text.length > 260 || text.split('\n').length > 7;
  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '86%', marginBottom: 10 }}>
      <Pressable
        onLongPress={() => onCopy(entry.text ?? '')}
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: colors.selection, borderColor: colors.selection }
            : { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={long && !expanded ? { maxHeight: 130, overflow: 'hidden' } : undefined}>
          <Markdown text={text} />
        </View>
        {long ? (
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6}>
            <Text style={{ color: colors.accent, fontFamily: font.medium, fontSize: 12, marginTop: 6 }}>
              {expanded ? '▴ show less' : '▾ show more'}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
      {time ? (
        <Text style={[styles.time, { color: colors.muted, fontFamily: font.regular, alignSelf: isUser ? 'flex-end' : 'flex-start' }]}>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

function ActionButton({ label, color, onPress, busy }: { label: string; color: string; onPress: () => void; busy?: boolean }) {
  const { font } = useTheme();
  return (
    <Pressable
      onPress={() => {
        hapticTap();
        onPress();
      }}
      disabled={busy}
      style={({ pressed }) => [styles.action, { borderColor: color, opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color, fontFamily: font.medium, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function PaneDetailScreen() {
  const { colors, font } = useTheme();
  const { prefs } = useApp();
  const priv = prefs.privacyMode;
  const route = useRoute<RouteProp<RootStackParamList, 'PaneDetail'>>();
  const { paneId } = route.params;

  // While the user is actively replying/answering, poll faster for ~90s.
  const [fast, setFast] = useState(false);
  const fastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goFast = useCallback(() => {
    setFast(true);
    if (fastTimer.current) clearTimeout(fastTimer.current);
    fastTimer.current = setTimeout(() => setFast(false), 90_000);
  }, []);

  const [copied, setCopied] = useState(false);
  const copy = useCallback((t: string) => {
    if (!t) return;
    hapticTap();
    Clipboard.setStringAsync(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, []);

  const panes = usePanes();
  const pane: Pane | undefined = panes.data?.panes.find((p) => p.pane_id === paneId);
  const transcript = useTranscript(paneId, fast ? LIVE_POLL : 12000);
  const activity = useActivity(paneId);
  const [detailTab, setDetailTab] = useState<'conversation' | 'screen' | 'activity'>('conversation');
  const screen = useScreen(paneId, detailTab === 'screen');
  const actions = usePaneActions();
  const kbHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const isClaude = pane?.agent === 'claude';
  const prompt = usePrompt(paneId, !!isClaude, fast ? 2000 : 5000);
  const [reply, setReply] = useState('');
  const [visible, setVisible] = useState(10);
  const options = prompt.data?.waiting ? prompt.data.options : [];

  // Auto-scroll the conversation to the latest turn on new content / after sending.
  const scrollRef = useRef<ScrollView>(null);
  const lastCount = useRef(0);
  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);
  const entryCount = transcript.data?.entries?.length ?? 0;
  useEffect(() => {
    if (detailTab === 'conversation' && entryCount > lastCount.current) scrollToEnd();
    lastCount.current = entryCount;
  }, [entryCount, detailTab, scrollToEnd]);

  const confirmGoto = () =>
    Alert.alert('Jump to pane', 'This switches the focused pane in your tmux session.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Jump', onPress: () => actions.goto.mutate(paneId) },
    ]);

  const confirmInterrupt = () =>
    Alert.alert('Interrupt agent', 'Sends Ctrl+C to this pane. It interrupts the current turn; a second one can exit the agent.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Interrupt',
        style: 'destructive',
        onPress: () => {
          hapticWarn();
          actions.answer.mutate({ id: paneId, key: 'ctrl-c' });
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: kbHeight }}>
      <View style={styles.staticTop}>
      {/* header */}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.headRow}>
          <Text style={{ color: statusColor(pane?.status ?? '', colors), fontFamily: font.regular, fontSize: 15 }}>
            {statusGlyph(pane?.status ?? '')}
          </Text>
          <Text style={{ color: colors.accent, fontFamily: font.regular, fontSize: 15 }}>{agentGlyph(pane?.agent ?? '')}</Text>
          <Text style={[styles.title, { color: colors.text, fontFamily: font.bold }]} numberOfLines={1}>
            {pane?.project || paneId}
          </Text>
          {pane?.permission_mode ? <Badge text={pane.permission_mode} color={colors.magenta} /> : null}
        </View>
        <Text style={[styles.meta, { color: colors.muted, fontFamily: font.regular }]}>
          {pane?.target} · {pane?.agent} · {pane?.status}
          {pane?.age_minutes != null ? ` · ${ageLabel(pane.age_minutes)}` : ''}
        </Text>
        {pane?.wait_reason ? (
          <Text style={[styles.wait, { color: colors.waiting, fontFamily: font.medium }]}>◐ {pane.wait_reason}</Text>
        ) : null}
        {pane?.needs_from_you ? (
          <Text style={[styles.needs, { color: colors.attention, fontFamily: font.medium }]}>⚠ {redact(pane.needs_from_you, priv)}</Text>
        ) : null}
      </View>

      {/* decision - pending permission/choice menu */}
      {options.length > 0 ? (
        <View style={[styles.decision, { borderColor: colors.waiting, backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.waiting, fontFamily: font.semibold, fontSize: 12, marginBottom: 6 }}>
            ◐ {prompt.data?.wait_reason ?? 'waiting'} - choose:
          </Text>
          {options.map((o) => (
            <Pressable
              key={o.num}
              disabled={actions.answer.isPending}
              onPress={() => {
                hapticSelect();
                actions.answer.mutate({ id: paneId, key: String(o.num) });
                goFast();
              }}
              style={({ pressed }) => [styles.option, { borderColor: colors.border, opacity: pressed ? 0.5 : 1 }]}
            >
              <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 13 }}>
                <Text style={{ color: colors.accent }}>{o.num}.</Text> {o.label}
              </Text>
              {o.description ? (
                <Text style={{ color: colors.dim, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                  {o.description}
                </Text>
              ) : null}
            </Pressable>
          ))}
          <Pressable
            onPress={() => {
              actions.answer.mutate({ id: paneId, key: 'esc' });
              goFast();
            }}
            style={styles.escBtn}
          >
            <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 12 }}>Esc · cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {isClaude && prompt.isError ? (
        <Text style={[styles.hint, { color: colors.waiting, fontFamily: font.regular, marginTop: 10 }]}>
          Couldn't read the agent's prompt state - check VPN/token.
        </Text>
      ) : null}

      {/* actions */}
      <View style={styles.actions}>
        <ActionButton label="Seen" color={colors.accent} busy={actions.seen.isPending} onPress={() => actions.seen.mutate(paneId)} />
        <ActionButton
          label={pane?.marked_unread ? 'Unpin' : 'Pin'}
          color={colors.cyan}
          busy={actions.markUnread.isPending}
          onPress={() => actions.markUnread.mutate({ id: paneId, on: !pane?.marked_unread })}
        />
        <ActionButton label="Clear" color={colors.waiting} busy={actions.clear.isPending} onPress={() => actions.clear.mutate(paneId)} />
        <ActionButton label="Jump" color={colors.running} busy={actions.goto.isPending} onPress={confirmGoto} />
      </View>

      {/* tabs */}
      <View style={styles.tabBar}>
        {(['conversation', 'screen', 'activity'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setDetailTab(t)}
            style={[styles.tab, { borderColor: detailTab === t ? colors.accent : colors.border, backgroundColor: detailTab === t ? colors.surfaceAlt : 'transparent' }]}
          >
            <Text style={{ color: detailTab === t ? colors.accent : colors.muted, fontFamily: font.medium, fontSize: 12 }}>
              {t === 'conversation' ? 'Conversation' : t === 'screen' ? 'Screen' : 'Activity'}
            </Text>
          </Pressable>
        ))}
      </View>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

      {/* conversation */}
      {detailTab === 'conversation' ? (
      <>
      {transcript.isLoading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} /> : null}
      {transcript.isError ? (
        <Text style={[styles.hint, { color: colors.attention, fontFamily: font.regular }]}>
          Can't load transcript - set the bridge token in Settings.
        </Text>
      ) : null}
      {transcript.data && !transcript.data.found ? (
        <Text style={[styles.hint, { color: colors.muted, fontFamily: font.regular }]}>No transcript for this pane.</Text>
      ) : null}
      {(() => {
        const all = transcript.data?.entries ?? [];
        const shown = all.slice(-visible);
        const offset = all.length - shown.length;
        return (
          <>
            {all.length > visible ? (
              <Pressable onPress={() => setVisible((v) => v + 10)} hitSlop={6} style={styles.loadMore}>
                <Text style={{ color: colors.accent, fontFamily: font.medium, fontSize: 12 }}>
                  ↑ load {Math.min(10, all.length - visible)} older
                </Text>
              </Pressable>
            ) : null}
            {shown.map((e, i) => (
              <Turn key={offset + i} entry={e} priv={priv} onCopy={copy} />
            ))}
          </>
        );
      })()}
      </>
      ) : null}

      {/* live screen */}
      {detailTab === 'screen' ? (
        screen.isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
        ) : (
          <ScrollView horizontal style={[styles.screenWrap, { backgroundColor: colors.deepest }]} showsHorizontalScrollIndicator>
            <Text style={[styles.screen, { color: colors.dim, fontFamily: font.regular }]}>
              {redact(screen.data?.text ?? '', priv)}
            </Text>
          </ScrollView>
        )
      ) : null}

      {/* activity */}
      {detailTab === 'activity' ? (
        activity.data && activity.data.activity.length > 0 ? (
          <>
            {activity.data.activity.slice(-30).reverse().map((a, i) => (
              <Text key={i} style={[styles.actLine, { color: colors.muted, fontFamily: font.regular }]} numberOfLines={1}>
                <Text style={{ color: colors.dim }}>{a.time}</Text> <Text style={{ color: colors.cyan }}>{a.tool}</Text> {redact(a.label, priv)}
              </Text>
            ))}
          </>
        ) : (
          <Text style={[styles.hint, { color: colors.muted, fontFamily: font.regular }]}>No activity yet.</Text>
        )
      ) : null}
      </ScrollView>
      {isClaude && detailTab === 'conversation' ? (
        <View>
          {actions.send.isError ? (
            <Text style={[styles.replyError, { color: colors.attention, fontFamily: font.regular }]}>
              Couldn't deliver - check VPN/token. Your message is kept.
            </Text>
          ) : null}
          {actions.answer.isError ? (
            <Text style={[styles.replyError, { color: colors.waiting, fontFamily: font.regular }]}>
              Options changed - pull to refresh and choose again.
            </Text>
          ) : null}
          <View style={[styles.keyStrip, { backgroundColor: colors.deepest }]}>
            <ActionButton label="i" color={colors.running} busy={actions.answer.isPending} onPress={() => actions.answer.mutate({ id: paneId, key: 'i' })} />
            <ActionButton label="⌃V" color={colors.magenta} busy={actions.answer.isPending} onPress={() => actions.answer.mutate({ id: paneId, key: 'ctrl-v' })} />
            <ActionButton label="⌃C" color={colors.attention} busy={actions.answer.isPending} onPress={confirmInterrupt} />
          </View>
          <View
            style={[
              styles.replyBar,
              { borderColor: colors.border, backgroundColor: colors.deepest, paddingBottom: 8 + (kbHeight > 0 ? 0 : insets.bottom) },
            ]}
          >
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder="reply to agent…"
              placeholderTextColor={colors.muted}
              multiline
              editable={!actions.send.isPending}
              style={[styles.replyInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, fontFamily: font.regular }]}
            />
            <Pressable
              disabled={!reply.trim() || actions.send.isPending}
              onPress={() =>
                actions.send.mutate(
                  { id: paneId, text: reply },
                  {
                    onSuccess: () => {
                      hapticSuccess();
                      setReply('');
                      goFast();
                      scrollToEnd();
                    },
                  },
                )
              }
              style={({ pressed }) => [styles.sendBtn, { backgroundColor: colors.accent, opacity: !reply.trim() || actions.send.isPending ? 0.4 : pressed ? 0.7 : 1 }]}
            >
              <Text style={{ color: '#fff', fontFamily: font.semibold, fontSize: 13 }}>
                {actions.send.isPending ? '…' : 'Send'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {copied ? (
        <View style={[styles.toast, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} pointerEvents="none">
          <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 12 }}>Copied ✓</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 12, paddingBottom: 60 },
  staticTop: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, flex: 1 },
  meta: { fontSize: 12, marginTop: 6 },
  wait: { fontSize: 13, marginTop: 8 },
  needs: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  decision: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginTop: 12 },
  option: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6 },
  escBtn: { paddingVertical: 6, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  replyError: { fontSize: 12, paddingHorizontal: 12, paddingTop: 6 },
  keyStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  tabBar: { flexDirection: 'row', gap: 6, marginTop: 16 },
  tab: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  replyBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  replyInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, maxHeight: 120 },
  sendBtn: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 9 },
  action: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16 },
  sectionHeader: { fontSize: 11, letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  hint: { fontSize: 13, lineHeight: 18 },
  bubble: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  time: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  loadMore: { alignItems: 'center', paddingVertical: 8, marginBottom: 6 },
  toolChip: {
    alignSelf: 'flex-start',
    maxWidth: '86%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
    gap: 3,
  },
  screenWrap: { borderRadius: 8 },
  screen: { fontSize: 11, lineHeight: 15, padding: 10 },
  actLine: { fontSize: 11, lineHeight: 16 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 90,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
