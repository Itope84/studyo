import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MiniPlayer } from '@/components/MiniPlayer';
import { TabBar } from '@/components/TabBar';
import { Button, Notice } from '@/components/ui';
import { finishAccessSignIn, signInWithAccess } from '@/lib/access';
import { useChrome } from '@/lib/chrome';
import { events, useLive, watchForeground } from '@/lib/live';
import { registerServiceWorker } from '@/lib/offline';
import { usePrefs } from '@/lib/prefs';
import { queryClient } from '@/lib/query';
import { ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { c, scheme } = useTheme();
  const connection = usePrefs((s) => s.connection);
  const pathname = usePathname();
  const { tabs } = useChrome();

  // Back from a Cloudflare Access sign-in (web): the token is in the address bar.
  useEffect(() => {
    registerServiceWorker();
    if (finishAccessSignIn()) {
      useLive.getState().set({ accessExpired: false });
      if (usePrefs.getState().pendingConnection?.cfToken) router.replace('/connect');
    }
  }, []);

  // Without a server there is nothing to show: any deep link goes to Connect first.
  useEffect(() => {
    if (!connection && pathname !== '/connect') router.replace('/connect');
  }, [connection, pathname]);

  useEffect(() => {
    if (!connection) {
      events.stop();
      return;
    }
    events.stop();
    events.start();
    const unwatch = watchForeground();
    return () => {
      unwatch();
      events.stop();
    };
  }, [connection]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = c.canvas;
      document.documentElement.style.colorScheme = scheme;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', c.canvas);
    }
  }, [c.canvas, scheme]);

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.canvas },
          animation: 'fade',
        }}
      >
        <Stack.Screen
          name="player"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>
      <AccessBanner />
      <MiniPlayer />
      {connection && tabs ? <TabBar /> : null}
    </View>
  );
}

/** Cloudflare Access sign-in expired: reloading the page takes the person through Access's login. */
function AccessBanner() {
  const expired = useLive((s) => s.accessExpired);
  const connection = usePrefs((s) => s.connection);
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  if (!expired || !connection) return null;
  const signIn = async () => {
    setBusy(true);
    try {
      const token = await signInWithAccess(connection, pathname);
      if (token) {
        usePrefs.getState().setAccessToken(token);
        useLive.getState().set({ accessExpired: false });
        void queryClient.invalidateQueries();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 12, alignItems: 'center' }}
    >
      <View style={{ width: '100%', maxWidth: 720 }}>
        <Notice
          tone="info"
          icon="lock-outline"
          title="Sign in to Cloudflare Access"
          body={
            connection.cfToken
              ? 'Your sign-in has expired.'
              : 'This server is behind Cloudflare Access.'
          }
          action={<Button label="Sign in" icon="login" busy={busy} onPress={() => void signIn()} />}
        />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
  });
  const hydrated = usePrefs((s) => s.hydrated);

  useEffect(() => {
    if (loaded && hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, hydrated]);

  if (!loaded || !hydrated) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
