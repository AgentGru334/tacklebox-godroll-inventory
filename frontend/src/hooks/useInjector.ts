import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Batch, Match, Me, Stats } from "@/lib/types";

export const qk = {
  me: ["me"] as const,
  stats: ["stats"] as const,
  batches: ["batches"] as const,
  matches: (id: string) => ["matches", id] as const,
  catalog: ["catalog"] as const,
  queue: ["admin-queue"] as const,
  users: ["users"] as const,
  audit: ["audit"] as const,
  unlinked: ["unlinked"] as const,
  siteItems: ["site-items"] as const,
  history: ["import-history"] as const,
  share: ["worklist-share"] as const,
  validation: (id: string) => ["validation", id] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => apiGet<Me>("/me"), staleTime: 60_000 });
}

export function useStats() {
  return useQuery({ queryKey: qk.stats, queryFn: () => apiGet<Stats>("/stats") });
}

// The working batch is always the most recent import.
export function useLatestBatch() {
  const q = useQuery({
    queryKey: qk.batches,
    queryFn: () => apiGet<Batch[]>("/batches"),
    // keep polling while OCR verification is running so progress stays live
    refetchInterval: (query) => (query.state.data?.[0]?.analysis_status === "done" ? false : 2500),
  });
  return { ...q, batch: q.data?.[0] ?? null };
}

export function useMatches(batchId: string | undefined, live = false) {
  return useQuery({
    queryKey: qk.matches(batchId ?? "none"),
    queryFn: () => apiGet<Match[]>(`/batches/${batchId}/matches`),
    enabled: Boolean(batchId),
    refetchInterval: live ? 8000 : false,
  });
}

// Every key a batch/catalog change can affect.
export const BATCH_KEYS = [qk.stats, qk.batches, ["matches"], qk.catalog, qk.queue, qk.audit, qk.unlinked, qk.history, ["validation"]];
