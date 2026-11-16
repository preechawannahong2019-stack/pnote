import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.pnote.notes', // placeholder: change before the first store release (cannot change afterwards)
  appName: 'PNote',
  webDir: '../web/dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'never' },
  plugins: { PrivacyScreen: { enable: true } },
};

export default config;
