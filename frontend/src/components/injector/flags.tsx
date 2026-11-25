import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BATCH_KEYS } from "@/hooks/useInjector";
import { apiPost, errorMessage } from "@/lib/api";
import { REGEN_LABELS, STALE_LABELS } from "@/lib/types";
import type { CatalogItem, QuarantineIn, RegenStatus } from "@/lib/types";

/** Internal (admin/reviewer) warnings: stale level, missing website link, quarantine. Never shown on the public share page. */
export function StaleBadges({ item }: { item: CatalogItem }) {
  return (
    <>
      {item.quarantined && (
        <span className="rounded-sm bg-hazard/25 px-1 font-mono text-[9px] font-bold uppercase text-red-300" title={item.quarantine_reason} data-testid={`quarantined-${item.id}`}>Quarantined</span>
      )}
      {item.stale_reasons.map((r) => (
        <span key={r} data-testid={`stale-${r}-${item.id}`}
          className={`rounded-sm px-1 font-mono text-[9px] uppercase ${r === "needs_link" ? "bg-gold/10 text-gold/90" : "bg-hazard/15 text-red-300"}`}>
          ⚠ {STALE_LABELS[r] ?? r}
        </span>
      ))}
    </>
  );
}

const TONES: Record<RegenStatus, string> = {
  pending: "border-steel text-zinc-300",
  in_progress: "border-gold/50 text-gold",
  regenerated: "border-teal/50 text-teal",
  verified: "border-emerald-500/50 text-emerald-300",
  published: "border-emerald-400 bg-emerald-500/15 text-emerald-200",
};

export function RegenBadge({ status, testId }: { status: RegenStatus; testId?: string }) {
  return <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${TONES[status]}`} data-testid={testId}>{REGEN_LABELS[status]}</span>;
}

export function QuarantineButton({ item }: { item: CatalogItem }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: (body: QuarantineIn) => apiPost<CatalogItem>(`/catalog/${item.id}/quarantine`, body),
    onSuccess: (i) => {
      BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      setOpen(false);
      setReason("");
      toast.success(i.quarantined ? `${i.name} quarantined: it can't be published` : `${i.name} released from quarantine`);
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update quarantine")),
  });
  if (item.quarantined)
    return (
      <Button size="xs" variant="ghost" className="w-full" disabled={mut.isPending} data-testid={`release-${item.id}`} onClick={() => mut.mutate({ quarantined: false, reason: "" })}>
        <ShieldCheck className="h-3 w-3" /> Release
      </Button>
    );
  return (
    <>
      <Button size="xs" variant="ghost" className="w-full text-zinc-400" data-testid={`quarantine-${item.id}`} onClick={() => setOpen(true)}>
        <ShieldOff className="h-3 w-3" /> Quarantine
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="quarantine-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase">Quarantine {item.name}</DialogTitle>
            <DialogDescription>A quarantined record can't receive a new published card until an admin releases it. Its current card stays as it is.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="q-reason">Reason</Label>
            <Input id="q-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. serial disputed by the roll owner" data-testid="quarantine-reason-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || mut.isPending} data-testid="quarantine-confirm" onClick={() => mut.mutate({ quarantined: true, reason })}>Quarantine</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
