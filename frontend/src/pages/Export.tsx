import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageCheck, Loader2, AlertTriangle, UploadCloud, Lock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DecisionBadge, EmptyState, PageHeader, Panel, ReasonBadges, SerialPill, Stat } from "@/components/injector/ui";
import { BATCH_KEYS, qk, useLatestBatch, useMatches, useMe } from "@/hooks/useInjector";
import { apiDownload, apiGet, apiPost, errorMessage } from "@/lib/api";
import { CONFIRM_PHRASE } from "@/lib/types";
import { AnalysisProgress } from "@/components/injector/progress";
import { RollbackButton } from "@/components/injector/RollbackButton";
import { ValidationPanel } from "@/components/injector/ValidationPanel";
import type { DirectUploadIn, DirectUploadResult, ValidationReport } from "@/lib/types";

export default function ExportPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { batch, isLoading } = useLatestBatch();
  const { data: matches = [] } = useMatches(batch?.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState("");
  const isAdmin = me?.role === "admin";
  const exceptions = matches.filter((m) => m.status === "exception");
  const analyzing = batch?.analysis_status !== "done";
  const blocked = !batch || batch.pending > 0 || analyzing;
  const published = batch?.status === "published";
  const { data: v } = useQuery({
    queryKey: qk.validation(batch?.id ?? "none"),
    queryFn: () => apiGet<ValidationReport>(`/batches/${batch!.id}/validation`),
    enabled: Boolean(batch) && !analyzing && !published,
  });

  const invalidate = () => BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));

  const pkg = useMutation({
    mutationFn: () => apiDownload(`/batches/${batch!.id}/package`, "tacklebox-import-package.zip"),
    onSuccess: (name) => {
      invalidate();
      toast.success(`Reviewable import package downloaded: ${name}`);
    },
    onError: (e) => toast.error(errorMessage(e, "Package generation failed")),
  });

  const upload = useMutation({
    mutationFn: (body: DirectUploadIn) => apiPost<DirectUploadResult>(`/batches/${batch!.id}/direct-upload`, body),
    onSuccess: (r) => {
      invalidate();
      setDialogOpen(false);
      setAck(false);
      setPhrase("");
      toast.success(`SIMULATED apply complete: ${r.added} added, ${r.replaced} replaced, ${r.created} new records, ${r.placeholders} Card pending, ${r.held_for_regeneration} held for level-70 regeneration, ${r.blocked} blocked by validation.`);
    },
    onError: (e) => toast.error(errorMessage(e, "Direct upload failed")),
  });

  if (!isLoading && !batch)
    return (
      <div>
        <PageHeader kicker="Step 03" title="Export" />
        <EmptyState testId="export-empty" title="Nothing to export" body="Import and review a card batch first.">
          <Link to="/import" className={buttonVariants()} data-testid="export-go-import">Go to import</Link>
        </EmptyState>
      </div>
    );

  return (
    <div>
      <PageHeader kicker="Step 03" title="Export" />

      {batch && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Will replace" value={batch.approved} tone="teal" testId="export-approved" />
          <Stat label="Exceptions" value={batch.exceptions} tone="red" testId="export-exceptions" />
          <Stat label="Undecided" value={batch.pending} tone="gold" testId="export-pending" />
          <Stat label="Rejected" value={batch.rejected} testId="export-rejected" />
        </div>
      )}

      {batch && <div className="mt-5"><AnalysisProgress batch={batch} /></div>}
      {blocked && batch && !analyzing && (
        <div className="mt-5 flex flex-col gap-3 rounded-sm border border-gold/50 bg-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="export-blocked-banner">
          <div className="flex items-center gap-2 text-sm text-gold">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {batch.pending} exception(s) still need a decision before anything can be exported.
          </div>
          <Link to="/review" className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="export-go-review">Resolve in review</Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel className="relative overflow-hidden p-5" data-testid="package-panel">
          <div className="absolute right-0 top-0 rounded-bl-sm bg-teal px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#04151F]">Default</div>
          <PackageCheck className="h-7 w-7 text-teal" />
          <h2 className="mt-3 font-heading text-xl font-black uppercase text-white">Reviewable import package</h2>
          <p className="mt-1 text-sm text-zinc-400">
            A ZIP with the updated images, an updated <code className="font-mono text-teal">manifest.json</code>, <code className="font-mono text-teal">link_mapping.csv</code> (serial → website item), <code className="font-mono text-teal">exceptions_report.csv</code> and <code className="font-mono text-teal">import_summary.json</code>. Nothing is published.
          </p>
          <Button className="relative mt-5 w-full overflow-hidden font-bold uppercase" disabled={blocked || pkg.isPending} data-testid="generate-package-button" onClick={() => pkg.mutate()}>
            {!blocked && <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-glow-swipe bg-white/30" />}
            {pkg.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Generate package
          </Button>
          {batch?.package_generated_at && (
            <div className="mt-2 font-mono text-[11px] text-zinc-400" data-testid="package-generated-at">
              Last generated {new Date(batch.package_generated_at).toLocaleString()}
            </div>
          )}
        </Panel>

        <Panel className="relative overflow-hidden border-hazard/40 p-5" data-testid="direct-upload-panel">
          <div className="hazard-stripes absolute inset-x-0 top-0 h-1.5" />
          <UploadCloud className="h-7 w-7 text-gold" />
          <h2 className="mt-3 font-heading text-xl font-black uppercase text-white">
            Approve &amp; apply <span className="ml-1 rounded-sm bg-gold px-1.5 py-0.5 align-middle font-mono text-[10px] text-[#1C1100]">SIMULATED</span>
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Applies the previewed import to this app's library: adds and replaces cards, creates new records, publishes Card pending for missing records, and holds level-conflict cards. Every change is audit-logged and can be restored. No real production system is involved. Requires a separate typed final confirmation. Admins only.
          </p>
          {published ? (
            <div className="mt-5 rounded-sm border border-teal/40 bg-teal/5 px-3 py-2 text-sm text-teal" data-testid="direct-upload-done">
              Published {batch?.published_at ? new Date(batch.published_at).toLocaleString() : ""} by {batch?.published_by}
            </div>
          ) : null}
          {published && isAdmin && batch && <div className="mt-3"><RollbackButton batchId={batch.id} /></div>}
          {batch?.rolled_back_at && (
            <div className="mt-5 rounded-sm border border-gold/40 bg-gold/5 px-3 py-2 text-sm text-gold" data-testid="rollback-done">
              Rolled back {new Date(batch.rolled_back_at).toLocaleString()} by {batch.rolled_back_by}. You can apply it again.
            </div>
          )}
          {!published && (
            <Button variant="outline" className="mt-5 w-full border-gold/50 font-bold uppercase text-gold hover:bg-gold/10" disabled={blocked || !isAdmin}
              data-testid="direct-upload-open" onClick={() => setDialogOpen(true)}>
              {!isAdmin && <Lock className="h-4 w-4" />} Approve &amp; apply…
            </Button>
          )}
          {!isAdmin && <div className="mt-2 font-mono text-[11px] text-zinc-500" data-testid="direct-upload-admin-only">Only admins can approve and apply an import.</div>}
        </Panel>
      </div>

      {v && !published && <ValidationPanel v={v} />}

      <Panel className="mt-6 p-5" data-testid="export-exceptions-panel">
        <h2 className="font-heading text-lg font-black uppercase text-white">All exceptions in this batch ({exceptions.length})</h2>
        <p className="mt-1 text-sm text-zinc-400">Every exception is listed here before export, with its decision.</p>
        <div className="mt-4 divide-y divide-steel">
          {exceptions.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`export-exception-${m.index}`}>
              <div className="min-w-0 space-y-1">
                <div className="font-semibold text-white">{m.catalog_name || m.manifest_name || "Unknown item"}</div>
                <SerialPill serial={m.serial} />
                <ReasonBadges reasons={m.reasons} />
              </div>
              <DecisionBadge decision={m.decision} />
            </div>
          ))}
          {exceptions.length === 0 && <p className="py-3 text-sm text-zinc-400">No exceptions. Every card matched cleanly.</p>}
        </div>
      </Panel>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setAck(false); setPhrase(""); } }}>
        <DialogContent className="overflow-hidden border-hazard/60" data-testid="direct-upload-dialog">
          <div className="hazard-stripes absolute inset-x-0 top-0 h-2" />
          <DialogHeader className="pt-2">
            <DialogTitle className="font-heading uppercase">Final confirmation: apply import</DialogTitle>
            <DialogDescription>
              SIMULATED. {batch?.approved ?? 0} approved card(s) will replace library images immediately, without a package review. This cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-start gap-3 text-sm text-zinc-300">
              <Checkbox checked={ack} onCheckedChange={(c) => setAck(Boolean(c))} data-testid="direct-upload-ack" />
              I reviewed every exception and want to skip the reviewable package.
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-phrase">Type <span className="font-mono text-gold">{CONFIRM_PHRASE}</span> to continue</Label>
              <Input id="confirm-phrase" autoComplete="off" data-testid="direct-upload-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" data-testid="direct-upload-cancel" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" data-testid="direct-upload-confirm" disabled={!ack || phrase.trim() !== CONFIRM_PHRASE || upload.isPending}
              onClick={() => upload.mutate({ confirmation: phrase, acknowledged: ack })}>
              {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Upload now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
