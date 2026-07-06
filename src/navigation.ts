export type RootStackParamList = {
  Tabs: undefined;
  PaneDetail: { paneId: string; title?: string };
  Settings: undefined;
};

export type TabParamList = {
  Summary: undefined;
  Tiles: undefined;
  Overview: undefined;
  Search: undefined;
};

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
export type RootNav = NativeStackNavigationProp<RootStackParamList>;
