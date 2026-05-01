export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  pagination?: { page: number; pageSize: number; total: number };
  error?: { code: string; message: string };
}

export interface SessionData {
  user: { id: string; username: string; displayName?: string | null; role: string; status: string };
  csrfToken: string;
  expiresAt: string;
}

let csrfToken = window.localStorage.getItem("opstage.csrf") ?? "";

export function setCsrfToken(token: string) {
  csrfToken = token;
  window.localStorage.setItem("opstage.csrf", token);
}

export function clearCsrfToken() {
  csrfToken = "";
  window.localStorage.removeItem("opstage.csrf");
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase()) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include"
  });
  const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || envelope.success === false) {
    throw new ApiError(response.status, envelope.error?.code ?? "REQUEST_ERROR", envelope.error?.message ?? response.statusText);
  }
  return envelope.data;
}

export async function apiList<T>(path: string): Promise<{ data: T[]; pagination?: ApiEnvelope<T[]>["pagination"] }> {
  const response = await fetch(path, { credentials: "include" });
  const envelope = (await response.json()) as ApiEnvelope<T[]>;
  if (!response.ok || envelope.success === false) {
    throw new ApiError(response.status, envelope.error?.code ?? "REQUEST_ERROR", envelope.error?.message ?? response.statusText);
  }
  return { data: envelope.data, pagination: envelope.pagination };
}

export const login = async (username: string, password: string) => {
  const data = await apiFetch<SessionData>("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  setCsrfToken(data.csrfToken);
  return data;
};

export const me = async () => {
  const data = await apiFetch<SessionData>("/api/admin/auth/me");
  setCsrfToken(data.csrfToken);
  return data;
};

export const logout = async () => {
  try {
    await apiFetch<{ success: true }>("/api/admin/auth/logout", { method: "POST" });
  } finally {
    clearCsrfToken();
  }
};

export async function apiDownload(path: string, options: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase()) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null) as ApiEnvelope<unknown> | null;
    throw new ApiError(response.status, envelope?.error?.code ?? "REQUEST_ERROR", envelope?.error?.message ?? response.statusText);
  }
  return await response.blob();
}
