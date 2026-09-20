import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@wideo11/api-client";
import { useAuthActions, useIsLoading } from "./store";

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setAuth } = useAuthActions();

  return useMutation({
    mutationFn: async (credentials: { email: string; password: string; rememberMe?: boolean }) => {
      const response = await apiClient.post<{
        user: any;
        accessToken: string;
        refreshToken: string;
      }>("/auth/login", credentials);
      return response.data;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      router.push("/");
    },
  });
}

export function useRegister() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setAuth } = useAuthActions();

  return useMutation({
    mutationFn: async (data: {
      email: string;
      password: string;
      username: string;
      displayName?: string;
    }) => {
      const response = await apiClient.post<{
        user: any;
        accessToken: string;
        refreshToken: string;
      }>("/auth/register", data);
      return response.data;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      router.push("/");
    },
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { logout } = useAuthActions();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post("/auth/logout");
    },
    onSuccess: () => {
      logout();
      queryClient.clear();
      router.push("/auth/login");
    },
  });
}

export function useRefreshToken() {
  const { setTokens, logout } = useAuthActions();

  return useMutation({
    mutationFn: async (refreshToken: string) => {
      const response = await apiClient.post<{ accessToken: string; refreshToken: string }>(
        "/auth/refresh",
        { refreshToken }
      );
      return response.data;
    },
    onSuccess: (data) => {
      setTokens(data.accessToken, data.refreshToken);
    },
    onError: () => {
      logout();
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      await apiClient.post("/auth/password/reset", { email });
    },
  });
}

export function useConfirmPasswordReset() {
  const router = useRouter();

  return useMutation({
    mutationFn: async (data: { token: string; password: string }) => {
      await apiClient.post("/auth/password/reset/confirm", data);
    },
    onSuccess: () => {
      router.push("/auth/login?reset=success");
    },
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (token: string) => {
      await apiClient.post("/auth/verify-email", { token });
    },
  });
}

export function useSetupPin() {
  const { setTokens } = useAuthActions();

  return useMutation({
    mutationFn: async (pin: string) => {
      const response = await apiClient.post<{ accessToken: string; refreshToken: string }>(
        "/auth/pin/setup",
        { pin }
      );
      return response.data;
    },
    onSuccess: (data) => {
      setTokens(data.accessToken, data.refreshToken);
    },
  });
}

export function useVerifyPin() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const response = await apiClient.post<{ accessToken: string; refreshToken: string }>(
        "/auth/pin/verify",
        { pin }
      );
      return response.data;
    },
  });
}

export function useAuth() {
  const isLoading = useIsLoading();
  const actions = useAuthActions();

  return {
    isLoading,
    ...actions,
  };
}