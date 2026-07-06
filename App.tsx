import { createNavigationContainerRef, DarkTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getBaseUrl, setBaseUrl as persistBaseUrl } from './src/config';
import { AppProvider } from './src/context';
import { useOverviewFull } from './src/hooks';
import { NotificationsController } from './src/NotificationsController';
import type { RootStackParamList, TabParamList } from './src/navigation';
import { queryClient } from './src/queryClient';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { PaneDetailScreen } from './src/screens/PaneDetailScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { TilesScreen } from './src/screens/TilesScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const TAB_GLYPH: Record<keyof TabParamList, string> = {
  Summary: '≡',
  Tiles: '▦',
  Overview: '☰',
  Search: '⌕',
};

function Tabs() {
  const { colors, font } = useTheme();
  // Overview is optional - like the TUI, it only appears when an overview.json
  // exists (the bridge serves it via /overview/full).
  const overview = useOverviewFull();
  const hasOverview = (overview.data?.projects?.length ?? 0) > 0;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.deepest, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontFamily: font.regular, fontSize: 18 }}>{TAB_GLYPH[route.name]}</Text>
        ),
      })}
    >
      <Tab.Screen name="Summary" component={SummaryScreen} />
      <Tab.Screen name="Tiles" component={TilesScreen} />
      {hasOverview ? <Tab.Screen name="Overview" component={OverviewScreen} /> : null}
      <Tab.Screen name="Search" component={SearchScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { colors, font } = useTheme();
  const [baseUrl, setUrl] = useState<string | null>(null);

  useEffect(() => {
    getBaseUrl().then(setUrl);
  }, []);

  const save = async (url: string) => {
    await persistBaseUrl(url);
    setUrl(url.trim().replace(/\/+$/, ''));
  };

  const navTheme: NavTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: colors.bg,
      card: colors.deepest,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
    },
  };

  if (baseUrl === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <AppProvider baseUrl={baseUrl} setBaseUrl={save}>
      {!baseUrl ? (
        <SettingsScreen initialUrl="" onSave={save} />
      ) : (
        <>
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.deepest },
              headerTitleStyle: { color: colors.text, fontFamily: font.semibold },
              headerTintColor: colors.accent,
              headerBackButtonDisplayMode: 'minimal',
            }}
          >
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="PaneDetail" component={PaneDetailScreen} options={({ route }) => ({ title: route.params.title ?? 'Agent' })} />
            <Stack.Screen name="Settings" options={{ presentation: 'modal', title: 'Settings' }}>
              {(props) => <SettingsScreen initialUrl={baseUrl} onSave={save} onClose={() => props.navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
          <NotificationsController
            onOpenPane={(id) => {
              if (navigationRef.isReady()) navigationRef.navigate('PaneDetail', { paneId: id });
            }}
          />
        </>
      )}
    </AppProvider>
  );
}

export default function App() {
  // Pause polling while backgrounded and refetch on return (RN has no window-focus
  // by default, so wire React Query's focusManager to AppState).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StatusBar style="light" />
          <Root />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
