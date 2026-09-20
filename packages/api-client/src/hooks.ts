import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";
import { apiClient } from "./client";
import { z } from "zod";

export function createQueryHooks<T extends z.ZodType<any, any, any>>(
  schema: T,
  endpoint: string,
  keyPrefix: string
) {
  type TData = z.infer<T>;

  function useList(params?: Record<string, unknown>, options?: UseQueryOptions<TData[]>) {
    return useQuery({
      queryKey: [keyPrefix, "list", params],
      queryFn: () => apiClient.get<TData[]>(endpoint, params).then((res) => res.data),
      ...options,
    });
  }

  function useGet(id: string, options?: UseQueryOptions<TData>) {
    return useQuery({
      queryKey: [keyPrefix, "detail", id],
      queryFn: () => apiClient.get<TData>(`${endpoint}/${id}`).then((res) => res.data),
      enabled: !!id,
      ...options,
    });
  }

  function useCreate(options?: UseMutationOptions<TData, Error, Partial<TData>>) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (data) => apiClient.post<TData>(endpoint, data).then((res) => res.data),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [keyPrefix, "list"] });
      },
      ...options,
    });
  }

  function useUpdate(options?: UseMutationOptions<TData, Error, { id: string; data: Partial<TData> }>) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }) => apiClient.put<TData>(`${endpoint}/${id}`, data).then((res) => res.data),
      onSuccess: (data, variables) => {
        queryClient.invalidateQueries({ queryKey: [keyPrefix, "list"] });
        queryClient.invalidateQueries({ queryKey: [keyPrefix, "detail", variables.id] });
      },
      ...options,
    });
  }

  function useDelete(options?: UseMutationOptions<void, Error, string>) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (id) => {
        await apiClient.delete(`${endpoint}/${id}`);
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [keyPrefix, "list"] });
      },
      ...options,
    });
  }

  return { useList, useGet, useCreate, useUpdate, useDelete };
}

export function useApiQuery<T>(key: string[], url: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<T>(url, params).then((res) => res.data),
  });
}

export function useApiMutation<T, TVariables>(
  url: string,
  method: "post" | "put" | "patch" | "delete" = "post"
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) =>
      apiClient[method]<T>(url, variables).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}