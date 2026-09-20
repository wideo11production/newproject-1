import { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";
import { z } from "zod";
export declare function createQueryHooks<T extends z.ZodType<any, any, any>>(schema: T, endpoint: string, keyPrefix: string): {
    useList: (params?: Record<string, unknown>, options?: UseQueryOptions<z.TypeOf<T>[]>) => import("@tanstack/react-query").UseQueryResult<z.TypeOf<T>[], Error>;
    useGet: (id: string, options?: UseQueryOptions<z.TypeOf<T>>) => import("@tanstack/react-query").UseQueryResult<z.TypeOf<T>, Error>;
    useCreate: (options?: UseMutationOptions<z.TypeOf<T>, Error, Partial<z.TypeOf<T>>>) => import("@tanstack/react-query").UseMutationResult<z.TypeOf<T>, Error, Partial<z.TypeOf<T>>, unknown>;
    useUpdate: (options?: UseMutationOptions<z.TypeOf<T>, Error, {
        id: string;
        data: Partial<z.TypeOf<T>>;
    }>) => import("@tanstack/react-query").UseMutationResult<z.TypeOf<T>, Error, {
        id: string;
        data: Partial<z.TypeOf<T>>;
    }, unknown>;
    useDelete: (options?: UseMutationOptions<void, Error, string>) => import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
};
export declare function useApiQuery<T>(key: string[], url: string, params?: Record<string, unknown>): import("@tanstack/react-query").UseQueryResult<T, Error>;
export declare function useApiMutation<T, TVariables>(url: string, method?: "post" | "put" | "patch" | "delete"): import("@tanstack/react-query").UseMutationResult<T, Error, TVariables, unknown>;
//# sourceMappingURL=hooks.d.ts.map