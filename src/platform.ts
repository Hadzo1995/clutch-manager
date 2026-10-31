/**
 * Where the game runs: the website (desktop or phone browser, optionally installed to the
 * home screen) or the native Android/iPhone app built with Capacitor.
 */
import { Capacitor } from '@capacitor/core';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): 'android' | 'ios' | 'web' => Capacitor.getPlatform() as 'android' | 'ios' | 'web';

/** True when the website runs as an installed app from the home screen. */
export const isInstalledWebApp = (): boolean =>
  typeof window !== 'undefined' && (!!window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/**
 * Offline support for the website. Not in the native app (its files are already on the phone)
 * and not on the dev server (it would cache stale modules).
 */
export function registerOffline(): void {
  if (isNativeApp() || import.meta.env.DEV || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline play is a bonus, never a blocker */ }); });
}

/** Native app: dark status bar that the game draws under, and the splash screen hidden once React has rendered. */
export async function setupNative(): Promise<void> {
  if (!isNativeApp()) return;
  document.documentElement.classList.add('native', `native-${nativePlatform()}`);
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
  } catch { /* the plugin is optional */ }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* the plugin is optional */ }
}

/*
 * Saves in the native app. The WebView's localStorage is not reliable there: Android only writes it
 * to disk now and then (progress was lost when the app was closed from the app switcher), and iOS
 * may clear it when the phone is short of space. So every save is also kept in native storage
 * (SharedPreferences / UserDefaults) and copied back into localStorage before the game starts.
 */
const NATIVE_KEYS = ['clutch-manager.save.v1', 'clutch-manager.dataset.v1'];

export function mirrorToNative(key: string, value: string | null): void {
  if (!isNativeApp()) return;
  void import('@capacitor/preferences').then(({ Preferences }) => (value === null ? Preferences.remove({ key }) : Preferences.set({ key, value }))).catch(() => { /* localStorage still has it */ });
}

/** Copies the native copy of each save back into localStorage when it is newer (or localStorage lost it). */
export async function restoreFromNative(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    for (const key of NATIVE_KEYS) {
      const { value } = await Preferences.get({ key });
      if (value === null) continue;
      const local = localStorage.getItem(key);
      if (local === value) continue;
      if (local === null || savedAt(value) >= savedAt(local)) localStorage.setItem(key, value);
    }
  } catch { /* fall back to whatever localStorage has */ }
}

function savedAt(raw: string): number {
  try { const t = Date.parse((JSON.parse(raw) as { savedAt?: string }).savedAt ?? ''); return Number.isFinite(t) ? t : 0; } catch { return 0; }
}
