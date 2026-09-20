import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { decodeJwt } from "jose";

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: "user" | "creator" | "moderator" | "admin" | "superadmin";
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User | null) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  hasRole: (roles: string[]) => boolean;
  getToken: () => string | null;
}

const decodeToken = (token: string): { exp: number; role?: string } | null => {
  try {
    return decodeJwt(token) as { exp: number; role?: string };
  } catch {
    return null;
  }
};

const isTokenExpired = (token: string): boolean => {
  const decoded = decodeToken(token);
  if (!decoded) return true;
  return Date.now() >= decoded.exp * 1000;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,

      setAuth: (user, accessToken, refreshToken) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
      },

      setTokens: (accessToken, refreshToken) => {
        const isExpired = accessToken && isTokenExpired(accessToken);
        set({
          accessToken,
          refreshToken,
          isAuthenticated: !isExpired && !!accessToken,
        });
      },

      logout: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      setLoading: (isLoading) => {
        set({ isLoading });
      },

      hasRole: (roles) => {
        const { user } = get();
        if (!user) return false;
        return roles.includes(user.role);
      },

      getToken: () => {
        const { accessToken } = get();
        if (!accessToken) return null;
        if (isTokenExpired(accessToken)) return null;
        return accessToken;
      },
    }),
    {
      name: "w11-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const { accessToken } = state;
          if (accessToken && isTokenExpired(accessToken)) {
            state.logout();
          } else {
            state.setLoading(false);
          }
        }
      },
    }
  )
);

export const useUser = () => useAuthStore((state) => state.user);
export const useAccessToken = () => useAuthStore((state) => state.accessToken);
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useIsLoading = () => useAuthStore((state) => state.isLoading);
export const useAuthActions = () => useAuthStore((state) => ({
  setAuth: state.setAuth,
  setUser: state.setUser,
  setTokens: state.setTokens,
  logout: state.logout,
  hasRole: state.hasRole,
  getToken: state.getToken,
}));