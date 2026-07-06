import { storageGet, storageSet } from './storage';

const BASE_URL_KEY = 'bridgeBaseUrl';
const TOKEN_KEY = 'bridgeToken';
const THEME_KEY = 'themeName';

// The bridge lives on the dev-box, reachable only over LAN/WireGuard. The user
// sets its URL + bearer token (for mutating/interaction endpoints) on first run.
export async function getBaseUrl(): Promise<string> {
  return (await storageGet(BASE_URL_KEY)) ?? '';
}
export async function setBaseUrl(url: string): Promise<void> {
  await storageSet(BASE_URL_KEY, url.trim().replace(/\/+$/, ''));
}

export async function getToken(): Promise<string> {
  return (await storageGet(TOKEN_KEY)) ?? '';
}
export async function setToken(token: string): Promise<void> {
  await storageSet(TOKEN_KEY, token.trim());
}

export async function getThemeName(): Promise<string | null> {
  return storageGet(THEME_KEY);
}
export async function setThemeName(name: string): Promise<void> {
  await storageSet(THEME_KEY, name);
}
