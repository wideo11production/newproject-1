"use client";

import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "./store";
import { useEffect } from "react";
import { apiClient } from "wideo11-api-client";

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLoading, isAuthenticated, accessToken, refreshToken } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      if (accessToken && refreshToken) {
        try {
          const response = await apiClient.post<{ accessToken: string; refreshToken: string }>(
            "/auth/refresh",
            { refreshToken }
          );
          const { accessToken: newAccessToken, refreshToken: newRefreshToken } = response.data;
          useAuthStore.getState().setTokens(newAccessToken, newRefreshToken);
        } catch {
          useAuthStore.getState().logout();
        }
      }
      setLoading(false);
    };

    initAuth();
  }, [accessToken, refreshToken, setLoading]);

  return <>{children}</>;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function QueryProvider({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}