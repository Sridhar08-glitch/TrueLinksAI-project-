import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi } from '../lib/api';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  setTokens: (access: string, refresh: string) => void;
  clearError: () => void;
  initializeAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, _get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login(email, password);
          const { access, refresh, user } = response.data;

          localStorage.setItem('access_token', access);
          localStorage.setItem('refresh_token', refresh);

          set({
            user,
            accessToken: access,
            refreshToken: refresh,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error: unknown) {
          const message =
            (error as { response?: { data?: { detail?: string; non_field_errors?: string[] } } })
              ?.response?.data?.detail ||
            (error as { response?: { data?: { non_field_errors?: string[] } } })
              ?.response?.data?.non_field_errors?.[0] ||
            'Login failed. Please check your credentials.';
          set({ isLoading: false, error: message, isAuthenticated: false });
          throw error;
        }
      },

      logout: async () => {
        const refresh = localStorage.getItem('refresh_token');
        try {
          await authApi.logout(refresh);
        } catch {
          // ignore logout errors
        } finally {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          // Clear the zustand persisted snapshot too
          localStorage.removeItem('auth-storage');
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            error: null,
          });
        }
      },

      setUser: (user: User) => set({ user }),

      setTokens: (access: string, refresh: string) => {
        localStorage.setItem('access_token', access);
        localStorage.setItem('refresh_token', refresh);
        set({ accessToken: access, refreshToken: refresh, isAuthenticated: true });
      },

      clearError: () => set({ error: null }),

      initializeAuth: async () => {
        const access = localStorage.getItem('access_token');
        const refresh = localStorage.getItem('refresh_token');
        if (!access || !refresh) {
          set({ isAuthenticated: false, user: null, accessToken: null, refreshToken: null, isLoading: false });
          return;
        }
        set({ isAuthenticated: true, accessToken: access, refreshToken: refresh, isLoading: true });
        try {
          // Rehydrate the user (and role) from the server so role routing is trustworthy
          const res = await authApi.me();
          set({ user: res.data, isLoading: false });
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('auth-storage');
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
