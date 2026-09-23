import { auth } from "./firebase";

/** `?dev=alice` in the URL (dev builds only) uses the server's DEV_AUTH_BYPASS so the app runs without Google sign-in. */
export const devUser = import.meta.env.DEV || import.meta.env.VITE_DEV_AUTH === "true" ? new URLSearchParams(location.search).get("dev") : null;

export async function token(): Promise<string | null> {
  if (devUser) return `dev:${devUser}`;
  return (await auth.currentUser?.getIdToken()) ?? null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const t = await token();
  const headers: Record<string, string> = {};
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Something went wrong", data.code);
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
