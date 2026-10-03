import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface Connection {
  url: string;
  token: string;
  cfClientId: string;
  cfClientSecret: string;
  /** Cloudflare Access token from the sign-in hand-off, sent as `cf-access-token`. */
  cfToken?: string;
}

interface Prefs {
  connection: Connection | null;
  theme: 'system' | 'light' | 'dark';
  speed: number;
  /** Last event id seen, so a reload or resume replays only what was missed. */
  lastEventId: number | null;
  /** `topic:resource` of a Continue card the person dismissed; a different item brings the card back. */
  dismissedContinue: string | null;
  homeSort: 'recent' | 'title' | 'progress';
  /** Chat messages whose "enrich further" offer was dismissed. */
  dismissedOffers: string[];
  /** A connection waiting for its Cloudflare Access sign-in to come back (web redirects lose page state). */
  pendingConnection: Connection | null;
  hydrated: boolean;
  setConnection: (c: Connection | null) => void;
  setTheme: (t: Prefs['theme']) => void;
  setSpeed: (s: number) => void;
  setLastEventId: (id: number | null) => void;
  dismissContinue: (key: string | null) => void;
  setHomeSort: (s: Prefs['homeSort']) => void;
  dismissOffer: (messageId: string) => void;
  setPending: (c: Connection | null) => void;
  setAccessToken: (token: string) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      connection: null,
      theme: 'system',
      speed: 1,
      lastEventId: null,
      dismissedContinue: null,
      homeSort: 'recent',
      dismissedOffers: [],
      pendingConnection: null,
      hydrated: false,
      setConnection: (connection) =>
        set({
          connection: connection
            ? { ...connection, url: connection.url.trim().replace(/\/+$/, '') }
            : null,
          lastEventId: null,
        }),
      setTheme: (theme) => set({ theme }),
      setSpeed: (speed) => set({ speed }),
      setLastEventId: (lastEventId) => set({ lastEventId }),
      dismissContinue: (dismissedContinue) => set({ dismissedContinue }),
      setHomeSort: (homeSort) => set({ homeSort }),
      setPending: (pendingConnection) => set({ pendingConnection }),
      setAccessToken: (cfToken) =>
        set((s) => (s.connection ? { connection: { ...s.connection, cfToken } } : {})),
      dismissOffer: (id) =>
        set((s) => ({
          dismissedOffers: [...s.dismissedOffers.filter((x) => x !== id), id].slice(-200),
        })),
    }),
    {
      name: 'studyo-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        pendingConnection,
        connection,
        theme,
        speed,
        lastEventId,
        dismissedContinue,
        homeSort,
        dismissedOffers,
      }) => ({
        connection,
        theme,
        speed,
        lastEventId,
        dismissedContinue,
        homeSort,
        dismissedOffers,
        pendingConnection,
      }),
      onRehydrateStorage: () => () => usePrefs.setState({ hydrated: true }),
    },
  ),
);
