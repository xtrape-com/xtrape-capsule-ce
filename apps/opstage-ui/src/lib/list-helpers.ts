import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiDownload } from "../api.js";

/**
 * Render the supplied params as a `?key=value&...` query string,
 * dropping `undefined` / `null` / empty-string entries. Used by every
 * list page to derive the API URL from current filters + page state.
 */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * Hydrate a strongly-typed filter object from `location.search`. Used by
 * pages that mirror filter state into the URL for shareable links.
 */
export function searchFilters<T extends Record<string, string | undefined>>(
  search: string,
  keys: Array<keyof T>,
  defaults: T,
): T {
  const params = new URLSearchParams(search);
  const values: Record<string, string | undefined> = { ...defaults };
  for (const key of keys) values[String(key)] = params.get(String(key)) || undefined;
  return values as T;
}

export function sameFilters(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Thin wrapper over `useQuery` that returns the shape the UI expects:
 * `{ data, loading, error, reload }`. Each call generates its own
 * queryKey segment so list pages with the same loader signature don't
 * collide in the cache.
 */
export function useQueryData<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
  refreshMs?: number,
): { data: T | null; loading: boolean; error: string | null; reload: () => Promise<void> } {
  const queryId = React.useId();
  const query = useQuery({
    queryKey: [queryId, ...deps],
    queryFn: loader,
    refetchInterval: refreshMs,
    staleTime: refreshMs ? Math.min(refreshMs, 30_000) : 30_000,
  });
  return {
    data: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    reload: async () => {
      await query.refetch();
    },
  };
}

/**
 * Trigger a browser file download from an authenticated API response.
 * Wraps `apiDownload` with the Blob → object-URL → anchor click dance.
 */
export async function downloadBlob(path: string, filename: string, options?: RequestInit): Promise<void> {
  const blob = await apiDownload(path, options);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
