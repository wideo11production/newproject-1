import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from "axios";
import { getToken, setToken, clearToken } from "./auth-storage";

const API_BASE_URL =
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.["NEXT_PUBLIC_API_URL"] || "https://wideo11.com";

// Helper utility to introduce asynchronous delays for retry logic
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = getToken();
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        
        // ContextOverflowError Middleware Fix: Inject middle-out compression configuration transforms 
        // and safely scale down the token reservation limits whenever intercepting local chat completion requests
        if (config.url?.includes("/chat/completions") || config.url?.includes("/ai/stream")) {
          if (config.data && typeof config.data === "object") {
            config.data = {
              ...config.data,
              max_tokens: 16000,
              transforms: ["middle-out"]
            };
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { 
          _retry?: boolean; 
          _retryCount?: number; 
        };

        // 1. HTTP 429 RATE LIMIT INTERCEPTOR OVERRIDE (Upstream Provider Crash Protection)
        if (error.response?.status === 429) {
          originalRequest._retryCount = originalRequest._retryCount ?? 0;
          const maxRetries = 5; // Hard-clamped retry loop ceiling
          
          if (originalRequest._retryCount < maxRetries) {
            originalRequest._retryCount++;
            
            // Exponential backoff duration calculation (e.g., 1.5s, 3s, 6s, 12s) to bypass upstream blocks
            const backoffWaitTime = Math.pow(2, originalRequest._retryCount) * 750; 
            console.warn(`[ApiClient] Upstream rate limit encountered (429). Retrying execution loop attempt #${originalRequest._retryCount} after ${backoffWaitTime}ms...`);
            
            await delay(backoffWaitTime);
            return this.client(originalRequest); // Re-execute the request sequence smoothly
          }
        }

        // 2. HTTP 401 AUTHENTICATION EXPIRED INTERCEPTOR
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const refreshToken = getToken("refresh");
            if (refreshToken) {
              const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
              const { accessToken, refreshToken: newRefreshToken } = response.data;
              setToken(accessToken, newRefreshToken);
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;
              }
              return this.client(originalRequest);
            }
          } catch (refreshError) {
            clearToken();
            if (typeof window !== "undefined") {
              window.location.href = "/auth/login";
            }
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  public get<T>(url: string, params?: Record<string, unknown>) {
    return this.client.get<T>(url, { params });
  }

  public post<T>(url: string, data?: unknown) {
    return this.client.post<T>(url, data);
  }

  public put<T>(url: string, data?: unknown) {
    return this.client.put<T>(url, data);
  }

  public patch<T>(url: string, data?: unknown) {
    return this.client.patch<T>(url, data);
  }

  public delete<T>(url: string) {
    return this.client.delete<T>(url);
  }

  public getClient(): AxiosInstance {
    return this.client;
  }
}

export const apiClient = new ApiClient();
export default apiClient;
