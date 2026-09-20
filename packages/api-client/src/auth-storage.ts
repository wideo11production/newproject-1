const ACCESS_TOKEN_KEY = "w11_access_token";
const REFRESH_TOKEN_KEY = "w11_refresh_token";

export function getToken(type: "access" | "refresh" = "access"): string | null {
  if (typeof window === "undefined") return null;
  const key = type === "access" ? ACCESS_TOKEN_KEY : REFRESH_TOKEN_KEY;
  return localStorage.getItem(key);
}

export function setToken(accessToken: string, refreshToken?: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken("access");
}