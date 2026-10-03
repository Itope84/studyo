import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface Connection {
  url: string;
  token: string;
  cfClientId: string;
  cfClientSecret: string;
}

interface Prefs {
  connection: Connection | null;
  theme: 'system' | 'light' | 'dark';
  speed: number;
  /** Last event id seen, so a reload or resume replays only what was missed. */
  lastEventId: number | null;
  hydrated: boolean;
  setConnection: (c: Connection | null) => void;
  setTheme: (t: Prefs['theme']) => void;
  setSpeed: (s: number) => void;
  setLastEventId: (id: number | null) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      connection: null,
      theme: 'system',
      speed: 1,
      lastEventId: null,
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
    }),
    {
      name: 'studyo-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ connection, theme, speed, lastEventId }) => ({
        connection,
        theme,
        speed,
        lastEventId,
      }),
      onRehydrateStorage: () => () => usePrefs.setState({ hydrated: true }),
    },
  ),
);
