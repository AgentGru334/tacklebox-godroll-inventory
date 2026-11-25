import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BATCH_KEYS } from "@/hooks/useInjector";
import { apiPost, errorMessage } from "@/lib/api";
import type { RollbackResult } from "@/lib/types";

export const ROLLBACK_PHRASE = "ROLLBACK-CONFIRM";

const ROWS: [keyof RollbackResult, string][] = [
  ["cards_reverted", "Cards put back to their previous image"],
  ["records_archived", "New records removed (archived copy kept)"],
  ["placeholders_reverted", "Card pending placeholders withdrawn"],
  ["regen_flags_cleared", "Level-70 refresh flags cleared"],
  ["links_removed", "Automatic website links removed"],
];

/** Undo every change one applied import made, after a dry-run count and a typed confirmation. */
export function RollbackButton({ batchId, label = "Undo whole import", size = "default" }: { batchId: string; label?: string; size?: "default" | "sm" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const preview = useMutation({
    mutationFn: () => apiPost<RollbackResult>(`/batches/${batchId}/rollback`, { dry_run: true, confirmation: "" }),
    onError: (e) => { toast.error(errorMessage(e, "Could not preview rollback")); setOpen(false); },
  });
  const run = useMutation({
    mutationFn: () => apiPost<RollbackResult>(`/batches/${batchId}/rollback`, { dry_run: false, confirmation: phrase }),
    onSuccess: (r) => {
      BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      setOpen(false);
      setPhrase("");
      toast.success(`Import rolled back: ${r.cards_reverted} cards reverted, ${r.records_archived} records archived, ${r.conflicts.length} left as is.`);
    },
    onError: (e) => toast.error(errorMessage(e, "Rollback failed")),
  });
  const p = preview.data;

  return (
    <>
      <Button variant="outline" size={size} className="border-hazard/50 text-red-300 hover:bg-hazard/10" data-testid={`rollback-open-${batchId.slice(0, 8)}`}
        onClick={() => { setOpen(true); preview.mutate(); }}>
        <Undo2 className="h-4 w-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPhrase(""); }}>
        <DialogContent className="overflow-hidden border-hazard/60" data-testid="rollback-dialog">
          <div className="hazard-stripes absolute inset-x-0 top-0 h-2" />
          <DialogHeader className="pt-2">
            <DialogTitle className="font-heading uppercase">Undo whole import</DialogTitle>
            <DialogDescription>
              Reverts every recorded change from this import, newest first. Cards that were changed again afterwards stay as they are and are listed below. The batch goes back to review, so you can apply it again later.
            </DialogDescription>
          </DialogHeader>
          {preview.isPending && <p className="font-mono text-xs text-zinc-400"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Counting changes…</p>}
          {p && (
            <div className="space-y-3" data-testid="rollback-preview">
              {p.reversible_changes === 0 ? (
                <p className="text-sm text-gold" data-testid="rollback-nothing">This import has no individually recorded changes to undo. Imports applied before the audit log existed can't be rolled back this way.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {ROWS.map(([k, l]) => (
                    <li key={k} className="flex justify-between gap-3"><span className="text-zinc-300">{l}</span><b className="font-mono text-white" data-testid={`rollback-${k}`}>{String(p[k])}</b></li>
                  ))}
                </ul>
              )}
              {p.conflicts.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-sm border border-gold/40 bg-gold/5 p-2 font-mono text-[11px] text-gold" data-testid="rollback-conflicts">
                  {p.conflicts.map((c) => <div key={c}>{c}</div>)}
                </div>
              )}
              {p.reversible_changes > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="rollback-phrase">Type <span className="font-mono text-gold">{ROLLBACK_PHRASE}</span> to continue</Label>
                  <Input id="rollback-phrase" autoComplete="off" className="font-mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} data-testid="rollback-phrase" />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="rollback-cancel">Cancel</Button>
            <Button variant="destructive" data-testid="rollback-confirm" disabled={!p || p.reversible_changes === 0 || phrase.trim() !== ROLLBACK_PHRASE || run.isPending}
              onClick={() => run.mutate()}>
              {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Roll back import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
