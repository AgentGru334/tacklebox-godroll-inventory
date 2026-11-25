import { apiGet, apiPost, ApiError } from "@/lib/api";
import { API_BASE } from "@/lib/config";
import type { Batch, UploadSession } from "@/lib/types";

const CHUNK = 8 * 1024 * 1024;

export interface UploadProgress {
  stage: "uploading" | "assembling";
  sentBytes: number;
  totalBytes: number;
  resumed: boolean;
}

const keyFor = (f: File) => `tb-upload:${f.name}:${f.size}:${f.lastModified}`;

async function putChunk(id: string, n: number, blob: Blob, token: () => Promise<Record<string, string>>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/uploads/${id}/chunks/${n}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", ...(await token()) },
        body: blob,
      });
      if (res.ok) return;
      if (res.status < 500 && res.status !== 429) throw new ApiError(res.status, await res.json().catch(() => null));
    } catch (e) {
      if (e instanceof ApiError || attempt >= 6) throw e;
    }
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000))); // flaky phone network: back off
  }
}

/** Resumable chunked upload. Re-selecting the same file after a disconnect or a closed tab sends only missing chunks. */
export async function resumableUpload(
  file: File,
  addToCatalog: boolean,
  note: string,
  token: () => Promise<Record<string, string>>,
  onProgress: (p: UploadProgress) => void,
): Promise<Batch> {
  let session: UploadSession | null = null;
  const saved = localStorage.getItem(keyFor(file));
  if (saved) {
    session = await apiGet<UploadSession>(`/uploads/${saved}`).catch(() => null);
    if (session?.status === "complete" && session.batch_id) {
      localStorage.removeItem(keyFor(file));
      return apiGet<Batch>(`/batches/${session.batch_id}`);
    }
  }
  const resumed = Boolean(session);
  if (!session) {
    session = await apiPost<UploadSession>("/uploads", { filename: file.name, size: file.size, chunk_size: CHUNK, add_to_catalog: addToCatalog, note });
    localStorage.setItem(keyFor(file), session.id);
  }
  const done = new Set(session.received);
  const bytesOf = (n: number) => Math.min(CHUNK, file.size - n * CHUNK);
  let sent = [...done].reduce((a, n) => a + bytesOf(n), 0);
  onProgress({ stage: "uploading", sentBytes: sent, totalBytes: file.size, resumed });
  for (let n = 0; n < session.total_chunks; n++) {
    if (done.has(n)) continue;
    await putChunk(session.id, n, file.slice(n * CHUNK, n * CHUNK + bytesOf(n)), token);
    sent += bytesOf(n);
    onProgress({ stage: "uploading", sentBytes: sent, totalBytes: file.size, resumed });
  }
  onProgress({ stage: "assembling", sentBytes: file.size, totalBytes: file.size, resumed });
  const batch = await apiPost<Batch>(`/uploads/${session.id}/complete`);
  localStorage.removeItem(keyFor(file));
  return batch;
}
