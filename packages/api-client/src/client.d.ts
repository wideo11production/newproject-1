import { AxiosInstance, AxiosResponse } from "axios";
declare class ApiClient {
    private client;
    constructor();
    private setupInterceptors;
    get<T>(url: string, params?: Record<string, unknown>): Promise<AxiosResponse<T, any, {}, any>>;
    post<T>(url: string, data?: unknown): Promise<AxiosResponse<T, any, {}, any>>;
    put<T>(url: string, data?: unknown): Promise<AxiosResponse<T, any, {}, any>>;
    patch<T>(url: string, data?: unknown): Promise<AxiosResponse<T, any, {}, any>>;
    delete<T>(url: string): Promise<AxiosResponse<T, any, {}, any>>;
    getClient(): AxiosInstance;
}
export declare const apiClient: ApiClient;
export default apiClient;
//# sourceMappingURL=client.d.ts.map