import { create } from 'zustand';
import { secureStorage } from './storage';
import type { Me } from './types';

const ACCESS = 'mc.access';
const REFRESH = 'mc.refresh';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  accessToken: string | null;
  refreshToken: string | null;
  me: Me | null;
  hydrate: () => Promise<void>;
  signIn: (access: string, refresh: string, me: Me) => Promise<void>;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  me: null,
  hydrate: async () => {
    const [accessToken, refreshToken] = await Promise.all([secureStorage.get(ACCESS), secureStorage.get(REFRESH)]);
    set({ accessToken, refreshToken, status: refreshToken ? 'signedIn' : 'signedOut' });
  },
  signIn: async (accessToken, refreshToken, me) => {
    await Promise.all([secureStorage.set(ACCESS, accessToken), secureStorage.set(REFRESH, refreshToken)]);
    set({ accessToken, refreshToken, me, status: 'signedIn' });
  },
  setTokens: async (accessToken, refreshToken) => {
    await Promise.all([secureStorage.set(ACCESS, accessToken), secureStorage.set(REFRESH, refreshToken)]);
    set({ accessToken, refreshToken });
  },
  setMe: (me) => set({ me }),
  signOut: async () => {
    await Promise.all([secureStorage.remove(ACCESS), secureStorage.remove(REFRESH)]);
    set({ accessToken: null, refreshToken: null, me: null, status: 'signedOut' });
  },
}));
