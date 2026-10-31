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
    if (nativePlatform() === 'android') { await StatusBar.setOverlaysWebView({ overlay: true }); }
  } catch { /* the plugin is optional */ }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch { /* the plugin is optional */ }
}
