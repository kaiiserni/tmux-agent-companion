import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticTap } from '../haptics';
import { useTheme } from '../theme/ThemeProvider';

export function LockScreen({ onAuthenticate }: { onAuthenticate: () => void }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    onAuthenticate();
    // Re-prompt is manual after the first attempt (Cancel/failure shouldn't loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: insets.bottom,
        gap: 14,
      }}
    >
      <Text style={{ fontSize: 40 }}>🔒</Text>
      <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16 }}>Locked</Text>
      <Text style={{ color: colors.muted, fontFamily: font.regular, fontSize: 13, paddingHorizontal: 30, textAlign: 'center' }}>
        Agent conversations span multiple clients - unlock with Face ID to view them.
      </Text>
      <Pressable
        onPress={() => {
          hapticTap();
          onAuthenticate();
        }}
        style={({ pressed }) => ({
          marginTop: 10,
          borderWidth: 1,
          borderColor: colors.accent,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 20,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ color: colors.accent, fontFamily: font.medium, fontSize: 14 }}>Unlock</Text>
      </Pressable>
    </View>
  );
}
