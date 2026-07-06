import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme/ThemeProvider';

// Minimal markdown: **bold**, `code`, links, headers, and bullet lines. Enough to
// make agent messages readable without pulling in a full markdown engine.
function inline(text: string, font: { regular: string; bold: string }, code: string, link: string) {
  const parts: React.ReactNode[] = [];
  let key = 0;
  // Split a run by URLs so links stay clickable even inside bold spans.
  const pushRun = (str: string, style?: object) => {
    const urlRe = /https?:\/\/[^\s)\]]+/g;
    let last = 0;
    let u: RegExpExecArray | null;
    while ((u = urlRe.exec(str))) {
      if (u.index > last) parts.push(<Text key={key++} style={style}>{str.slice(last, u.index)}</Text>);
      const url = u[0];
      parts.push(
        <Text key={key++} onPress={() => Linking.openURL(url)} style={[style, { color: link, textDecorationLine: 'underline' }]}>
          {url}
        </Text>,
      );
      last = u.index + url.length;
    }
    if (last < str.length) parts.push(<Text key={key++} style={style}>{str.slice(last)}</Text>);
  };
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) pushRun(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) pushRun(tok.slice(2, -2), { fontFamily: font.bold });
    else parts.push(<Text key={key++} style={{ fontFamily: font.regular, color: code }}>{tok.slice(1, -1)}</Text>);
    last = m.index + tok.length;
  }
  if (last < text.length) pushRun(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const { colors, font } = useTheme();
  // Collapse blank-line runs + trim so bubbles don't render huge empty gaps.
  const lines = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().split('\n');
  return (
    <View>
      {lines.map((line, i) => {
        const header = line.match(/^(#{1,6})\s+(.*)/);
        if (header) {
          return (
            <Text key={i} style={[styles.header, { color: colors.text, fontFamily: font.bold }]}>
              {inline(header[2]!, font, colors.cyan, colors.accent)}
            </Text>
          );
        }
        const bullet = line.match(/^\s*[-*•]\s+(.*)/);
        if (bullet) {
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={{ color: colors.accent, fontFamily: font.regular, fontSize: 13 }}>• </Text>
              <Text style={[styles.bulletText, { color: colors.text, fontFamily: font.regular }]}>
                {inline(bullet[1]!, font, colors.cyan, colors.accent)}
              </Text>
            </View>
          );
        }
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        return (
          <Text key={i} style={[styles.body, { color: colors.text, fontFamily: font.regular }]}>
            {inline(line, font, colors.cyan, colors.accent)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 15, marginTop: 6, marginBottom: 2, lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 19 },
  bulletText: { fontSize: 13, lineHeight: 19, flex: 1 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start' },
});
