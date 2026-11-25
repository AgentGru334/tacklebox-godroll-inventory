import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RollbackButton } from "@/components/injector/RollbackButton";
import { EmptyState, PageHeader, Panel, SerialPill } from "@/components/injector/ui";
import { BATCH_KEYS, qk, useLatestBatch, useMe } from "@/hooks/useInjector";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import type { AuditEntry, CatalogItem } from "@/lib/types";
import { cardImageUrl } from "@/lib/config";

const ACTIONS = ["", "import_applied", "batch_imported", "card_replaced", "card_added", "card_restored", "record_created", "record_edited",
  "placeholder_published", "held_for_regeneration", "import_rolled_back", "level_decision", "match_decision", "site_linked", "site_unlinked", "package_generated", "catalog_imported", "site_codes_imported",
  "import_note_edited", "publish_blocked", "worklist_status", "quarantined", "quarantine_released", "worklist_share_on", "worklist_share_off"];

export default function AuditPage() {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const { data: batches = [] } = useLatestBatch();
  const byBatch = new Map(batches.map((b) => [b.id, b]));
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [...qk.audit, action, q],
    queryFn: () => apiGet<AuditEntry[]>(`/audit?action=${action}&q=${encodeURIComponent(q.trim())}`),
    enabled: isAdmin,
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost<CatalogItem>(`/audit/${id}/restore`),
    onSuccess: (i) => { BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k })); toast.success(`Previous card restored for ${i.name}.`); },
    onError: (e) => toast.error(errorMessage(e, "Restore failed")),
  });

  if (!meLoading && !isAdmin)
    return <div><PageHeader kicker="Restricted" title="Audit log" /><EmptyState testId="audit-forbidden" title="Admins only" body="Only admins can view the audit log and restore cards." /></div>;

  return (
    <div>
      <PageHeader kicker="Restricted · Admin" title="Audit log" />
      <Panel className="mb-4 flex flex-col gap-2 p-3 sm:flex-row">
        <Select value={action || "all"} onValueChange={(v: string) => setAction(v === "all" ? "" : v)}>
          <SelectTrigger className="sm:w-64" data-testid="audit-action-select"><SelectValue>{(v) => (v === "all" ? "All actions" : String(v).replace(/_/g, " "))}</SelectValue></SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => <SelectItem key={a || "all"} value={a || "all"}>{a ? a.replace(/_/g, " ") : "All actions"}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Exact serial / itemKey, item name or actor" className="sm:max-w-md" data-testid="audit-search-input" />
      </Panel>
      {isLoading && <p className="font-mono text-xs text-zinc-400">Loading…</p>}
      <div className="space-y-2" data-testid="audit-list">
        {rows.map((e) => {
          const canRestore = (e.action === "card_replaced" || e.action === "card_added") && !e.restored_at;
          return (
            <Panel key={e.id} className="grid gap-2 p-3 sm:grid-cols-[170px_1fr_auto] sm:items-center" data-testid={`audit-row-${e.id}`}>
              <div className="font-mono text-[11px] text-zinc-400">{new Date(e.at).toLocaleString()}<div className="truncate text-zinc-500">{e.actor}</div></div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-sm border border-teal/40 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-teal">{e.action.replace(/_/g, " ")}</span>
                  {e.item_name && <span className="font-semibold text-white">{e.item_name}</span>}
                  {e.site_item_id && <span className="font-mono text-[11px] text-gold">site #{e.site_item_id}</span>}
                  {e.restored_at && <span className="font-mono text-[10px] uppercase text-zinc-500">restored {new Date(e.restored_at).toLocaleDateString()}</span>}
                </div>
                {e.batch_id && byBatch.get(e.batch_id) && (() => { const b = byBatch.get(e.batch_id!)!; return (
                  <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={`audit-batch-${e.id}`}>
                    <span className="font-mono text-zinc-400">{b.filename} · {b.id.slice(0, 8)}</span>
                    <span className={`rounded-sm border px-1 font-mono text-[9px] uppercase ${b.status === "published" ? "border-teal/50 text-teal" : b.rolled_back_at ? "border-hazard/50 text-red-300" : "border-steel text-zinc-400"}`}>
                      {b.status === "published" ? "applied" : b.rolled_back_at ? "rolled back" : b.status.replace("_", " ")}
                    </span>
                    {b.note && <span className="text-zinc-300">“{b.note}”</span>}
                  </div>
                ); })()}
                {e.serial && <SerialPill serial={e.serial} />}
                {Object.keys(e.details).length > 0 && <div className="truncate font-mono text-[11px] text-zinc-500">{Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</div>}
                {(e.previous_image_id || e.new_image_id) && (
                  <div className="flex items-center gap-2">
                    {e.previous_image_id ? <img src={cardImageUrl(e.previous_image_id)} alt="previous" className="h-14 rounded-sm border border-steel" /> : <span className="font-mono text-[10px] text-zinc-500">no previous card</span>}
                    <span className="text-zinc-500">→</span>
                    {e.new_image_id && <img src={cardImageUrl(e.new_image_id)} alt="new" className="h-14 rounded-sm border border-teal/40" />}
                  </div>
                )}
              </div>
              {e.action === "import_applied" && e.batch_id && <RollbackButton batchId={e.batch_id} size="sm" />}
              {canRestore && (
                <Button size="sm" variant="outline" disabled={restore.isPending} data-testid={`audit-restore-${e.id}`} onClick={() => restore.mutate(e.id)}>
                  <Undo2 className="h-3.5 w-3.5" /> Restore previous card
                </Button>
              )}
            </Panel>
          );
        })}
        {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-zinc-400" data-testid="audit-empty">No entries.</p>}
      </div>
    </div>
  );
}
