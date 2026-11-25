import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Pencil, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, Panel } from "@/components/injector/ui";
import { RollbackButton } from "@/components/injector/RollbackButton";
import { qk, useMe } from "@/hooks/useInjector";
import { apiDownload, apiGet, apiPatch, errorMessage } from "@/lib/api";
import type { Batch, BatchNoteIn, ImportHistoryEntry } from "@/lib/types";

const CHANGE_LABELS: Record<string, string> = {
  card_replaced: "Cards replaced",
  card_added: "Cards added",
  record_created: "Records created",
  placeholder_published: "Card pending published",
  held_for_regeneration: "Held for LV70 refresh",
  site_linked: "Website links",
  match_decision: "Review decisions",
  level_decision: "Level decisions",
  card_restored: "Cards restored",
  publish_blocked: "Blocked by validation",
};
const EVENT_LABELS: Record<string, string> = {
  batch_imported: "ZIP imported",
  package_generated: "Package downloaded",
  import_applied: "Applied to library",
  import_rolled_back: "Whole import rolled back",
  import_note_edited: "Note edited",
};

function statusOf(b: ImportHistoryEntry["batch"]): { label: string; tone: string } {
  if (b.status === "published") return { label: "Applied", tone: "border-teal/50 bg-teal/10 text-teal" };
  if (b.rolled_back_at) return { label: "Rolled back", tone: "border-hazard/50 bg-hazard/10 text-red-300" };
  if (b.status === "package_generated") return { label: "Package ready", tone: "border-gold/50 bg-gold/10 text-gold" };
  return { label: b.pending > 0 ? "In review" : "Ready", tone: "border-steel bg-plate text-zinc-300" };
}

const fmt = (s: string) => new Date(s).toLocaleString();

function Entry({ h, isAdmin }: { h: ImportHistoryEntry; isAdmin: boolean }) {
  const b = h.batch;
  const st = statusOf(b);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(b.note);
  const saveNote = useMutation({
    mutationFn: () => apiPatch<Batch>(`/batches/${b.id}/note`, { note } satisfies BatchNoteIn),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: qk.history }); qc.invalidateQueries({ queryKey: qk.batches }); toast.success("Note saved"); },
    onError: (e) => toast.error(errorMessage(e, "Could not save the note")),
  });
  const short = b.id.slice(0, 8);
  const dl = useMutation({
    mutationFn: () => apiDownload(`/batches/${b.id}/package`, `tacklebox-import-package-${short}.zip`),
    onSuccess: (n) => toast.success(`Downloaded ${n}`),
    onError: (e) => toast.error(errorMessage(e, "Package download failed")),
  });
  const changes = Object.entries(h.changes).filter(([k]) => CHANGE_LABELS[k]);
  return (
    <li className="relative pl-8" data-testid={`history-entry-${short}`}>
      <span className="absolute left-[7px] top-2 h-3 w-3 rotate-45 border-2 border-gold bg-gunmetal" />
      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-heading text-base font-black uppercase text-white" data-testid={`history-filename-${short}`}>{b.filename}</span>
              <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${st.tone}`} data-testid={`history-status-${short}`}>{st.label}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-zinc-400">{fmt(b.created_at)} · {b.created_by} · batch {short}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!h.can_download || dl.isPending} onClick={() => dl.mutate()} data-testid={`history-download-${short}`}
              title={h.can_download ? "Download the reviewable package" : "Finish review and OCR first"}>
              {dl.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Package
            </Button>
            {isAdmin && b.status === "published" && <RollbackButton batchId={b.id} size="sm" label="Undo import" />}
          </div>
        </div>

        <div className="mt-2" data-testid={`history-note-${short}`}>
          {editing ? (
            <div className="flex gap-2">
              <Input value={note} maxLength={280} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="Why was this import run?" data-testid={`history-note-input-${short}`} />
              <Button size="sm" disabled={saveNote.isPending} onClick={() => saveNote.mutate()} data-testid={`history-note-save-${short}`}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setNote(b.note); }}>Cancel</Button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} data-testid={`history-note-edit-${short}`}
              className="flex items-start gap-1.5 text-left text-sm transition-colors duration-150 hover:text-white">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
              {b.note ? <span className="text-zinc-200">{b.note}</span> : <span className="text-zinc-500">Add a note: why was this import run?</span>}
              <Pencil className="mt-1 h-3 w-3 shrink-0 text-zinc-500" />
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid={`history-preview-${short}`}>
          {([["Cards", b.total], ["New", b.new_records], ["Replace", b.replacements], ["Unmatched", b.unmatched], ["OCR conflicts", b.ocr_conflicts], ["Missing", b.missing_records]] as const).map(([l, v]) => (
            <div key={l} className="rounded-sm border border-steel/70 bg-gunmetal/60 px-2 py-1.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">{l}</div>
              <div className="font-heading text-lg font-black tabular-nums text-white">{v}</div>
            </div>
          ))}
        </div>

        {changes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`history-changes-${short}`}>
            {changes.map(([k, n]) => (
              <span key={k} className="rounded-sm border border-teal/30 bg-teal/5 px-2 py-0.5 font-mono text-[11px] text-teal">{CHANGE_LABELS[k]} · {n}</span>
            ))}
          </div>
        )}

        <ol className="mt-3 space-y-1 border-t border-steel/60 pt-3 font-mono text-[11px]" data-testid={`history-events-${short}`}>
          {h.events.length === 0 && <li className="text-zinc-500">No recorded events (imported before the audit log existed).</li>}
          {h.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 text-zinc-400">
              <span className="text-zinc-500">{fmt(e.at)}</span>
              <span className={e.action === "import_rolled_back" ? "text-red-300" : e.action === "import_applied" ? "text-teal" : "text-zinc-200"}>{EVENT_LABELS[e.action] ?? e.action}</span>
              <span>· {e.actor}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </li>
  );
}

export default function History() {
  const { data: me } = useMe();
  const { data = [], isLoading, isError } = useQuery({ queryKey: qk.history, queryFn: () => apiGet<ImportHistoryEntry[]>("/imports/history") });
  return (
    <div>
      <PageHeader kicker="Timeline" title="Import history" />
      <p className="-mt-3 mb-5 max-w-3xl text-sm text-zinc-400">Every card import, newest first: what it changed, whether it's applied or rolled back, and its reviewable package.</p>
      {isLoading && <p className="font-mono text-xs text-zinc-400">Loading…</p>}
      {isError && <p className="text-sm text-red-300" data-testid="history-error">Could not load import history.</p>}
      {!isLoading && !isError && data.length === 0 && <EmptyState testId="history-empty" title="No imports yet" body="Upload a card ZIP to start the timeline." />}
      <ol className="relative space-y-4 before:absolute before:inset-y-2 before:left-[12px] before:w-px before:bg-steel" data-testid="history-timeline">
        {data.map((h) => <Entry key={h.batch.id} h={h} isAdmin={me?.role === "admin"} />)}
      </ol>
    </div>
  );
}
