/** Public backend origin, no trailing slash. Empty means same-origin (Vite proxy or a reverse proxy). */
const raw = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "";
export const BACKEND_URL = raw.replace(/\/$/, "");
export const API_BASE = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

export function cardImageUrl(imageId: string): string {
  return `${API_BASE}/cards/${imageId}`;
}
