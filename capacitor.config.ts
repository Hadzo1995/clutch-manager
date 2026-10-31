import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native Android and iPhone apps wrap the same web build (dist/), so the game stays one
 * codebase. After `npm run build`, `npx cap sync` copies dist/ into android/ and ios/.
 * See MOBILE.md for building and installing.
 */
const config: CapacitorConfig = {
  appId: 'com.hadzo.clutchmanager',
  appName: 'Clutch Manager',
  webDir: 'dist',
  backgroundColor: '#0a0e13',
  android: { backgroundColor: '#0a0e13' },
  ios: { backgroundColor: '#0a0e13', contentInset: 'never' },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#0a0e13', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#0a0e13' },
  },
};

export default config;
