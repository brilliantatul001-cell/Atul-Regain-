import type {CapacitorConfig} from '@capacitor/cli';

const rawLiveUrl = (
  process.env.LIVE_APP_URL ||
  process.env.CAPACITOR_SERVER_URL ||
  process.env.VITE_LIVE_APP_URL ||
  ''
)
  .trim()
  .replace(/\/+$/, '');

let liveUrl: string | undefined;
let liveHost: string | undefined;
if (rawLiveUrl) {
  try {
    const parsed = new URL(rawLiveUrl.startsWith('http') ? rawLiveUrl : `https://${rawLiveUrl}`);
    liveUrl = parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '');
    liveHost = parsed.hostname;
  } catch {
    liveUrl = undefined;
  }
}

const allowNavigation = Array.from(
  new Set([
    '*.vercel.app',
    '*.web.app',
    '*.firebaseapp.com',
    'accounts.google.com',
    '*.google.com',
    ...(liveHost ? [liveHost] : []),
  ]),
);

const config: CapacitorConfig = {
  appId: 'com.atul.leaveittimer',
  appName: 'Hour',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    ...(liveUrl ? {url: liveUrl} : {}),
    allowNavigation,
    cleartext: Boolean(liveUrl && liveUrl.startsWith('http://')),
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f1220',
  },
};

export default config;
