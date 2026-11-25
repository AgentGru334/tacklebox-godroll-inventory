// Typed fetch layer over the FastAPI backend. API_BASE is "/api" on a shared origin
// (dev Vite proxy, or a reverse proxy) and `${VITE_BACKEND_URL}/api` for a split-origin deploy.
import { API_BASE } from "@/lib/config";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;
type TokenGetter = () => Promise<string | null>;

// Clerk session token, registered by AuthBridge; sent as a Bearer header on every call.
let tokenGetter: TokenGetter | null = null;
export function setTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = tokenGetter ? await tokenGetter() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers: { ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  const res = await send(method, path, {
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);

// Public (no sign-in) POST, used by the share link.
export async function apiPostPublic<T>(path: string, body: JsonBody, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

// Public (no sign-in) GET: never waits on a Clerk session token, so signed-out visitors aren't blocked.
export async function apiGetPublic<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await send("POST", path, { body: form });
  return (await res.json()) as T;
}

// Fetches a file and hands it to the browser as a download.
export async function apiDownload(path: string, fallbackName: string): Promise<string> {
  const res = await send("GET", path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      const first = body.detail[0] as { msg?: string; loc?: unknown[] } | undefined;
      if (first?.msg) return `${first.loc?.slice(1).join(".") ?? ""} ${first.msg}`.trim();
    }
    if (err.status === 401) return "Your session expired. Sign in again.";
    if (err.status === 403) return "Only admins can do that.";
  }
  return fallback;
}
