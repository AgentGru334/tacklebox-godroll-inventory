import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X, RotateCcw, ArrowRight, Gauge, Columns2, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardImage, DecisionBadge, EmptyState, PageHeader, Panel, ReasonBadges, SerialPill } from "@/components/injector/ui";
import { AnalysisProgress, LevelBadge } from "@/components/injector/progress";
import { BATCH_KEYS, useLatestBatch, useMatches, useMe } from "@/hooks/useInjector";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { BLOCKING_REASONS, FLAG_LABELS, LEVEL_DECISION_LABELS } from "@/lib/types";
import type { DecisionIn, LevelDecision, LevelDecisionIn, Match, StatDiff } from "@/lib/types";
import { cardImageUrl } from "@/lib/config";

const PAGE = 60;
const FILTERS: Record<string, { label: string; test: (m: Match) => boolean }> = {
  all: { label: "All cards", test: () => true },
  manual: { label: "Manual decision required", test: (m) => m.decision === "pending" },
  exceptions: { label: "All exceptions", test: (m) => m.status === "exception" },
  clean: { label: "Clean matches", test: (m) => m.status === "clean" },
  confirmed_70: { label: "Confirmed level 70", test: (m) => m.level_status === "confirmed_70" },
  outdated: { label: "Likely outdated (level 60)", test: (m) => m.level_status === "outdated" },
  possible_misread: { label: "Possible OCR misread", test: (m) => m.level_status === "possible_misread" },
  unreadable: { label: "Level unreadable", test: (m) => m.level_status === "unreadable" },
  level_conflict: { label: "OCR vs manifest level conflict", test: (m) => m.reasons.includes("level_conflict") },
  ocr_conflict: { label: "OCR conflicts (any)", test: (m) => m.reasons.includes("level_conflict") || m.flags.length > 0 },
  new: { label: "New records", test: (m) => m.change === "new" },
  replacement: { label: "Replacements", test: (m) => m.change === "replacement" },
  unmatched: { label: "Unmatched cards", test: (m) => m.change === "unmatched" },
  duplicates: { label: "Duplicate files", test: (m) => m.reasons.includes("duplicate_image") || m.reasons.includes("duplicate_serial") },
  regen: { label: "Requires level-70 regeneration", test: (m) => m.level_decision === "require_regeneration" },
};

type Dlg = { match: Match; kind: "approve" | "reject" | "level" | "compare" };

function CompareView({ m, published, withStats = false }: { m: Match; published: boolean; withStats?: boolean }) {
  const name = m.catalog_name || m.manifest_name;
  const diff = useQuery({
    queryKey: ["stat-diff", m.id],
    queryFn: () => apiGet<StatDiff>(`/matches/${m.id}/stat-diff`),
    enabled: withStats && Boolean(m.compare_image_id),
    staleTime: Infinity,
    retry: false,
  });
  const changed = diff.data?.rows.filter((r) => r.changed) ?? [];
  const side = (label: string, id: string | null, tone: string, testId: string, key: "box_old" | "box_new") => (
    <figure className="min-w-0" data-testid={testId}>
      <figcaption className={`mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] ${tone}`}>{label}</figcaption>
      {id ? (
        <div className="relative">
          <img src={cardImageUrl(id)} alt={`${name}: ${label}`} className="w-full rounded-sm border border-steel bg-gunmetal object-contain" />
          {changed.map((r) => { const b = r[key]; return b ? (
            <span key={`${key}-${b.join(",")}`} className="pointer-events-none absolute rounded-[2px] border-2 border-gold shadow-[0_0_8px_rgba(255,184,0,0.6)]"
              style={{ left: `${b[0] * 100 - 0.5}%`, top: `${b[1] * 100 - 0.5}%`, width: `${b[2] * 100 + 1}%`, height: `${b[3] * 100 + 1}%` }} />
          ) : null; })}
        </div>
      ) : <div className="grid aspect-[3/4] place-items-center rounded-sm border border-dashed border-steel text-xs text-zinc-500">No card</div>}
    </figure>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3" data-testid="compare-view">
        {side(published ? "Before this import" : "Library now", m.compare_image_id, "text-zinc-400", "compare-old", "box_old")}
        {side(published ? "Applied by this import" : "Incoming card", m.image_id, "text-teal", "compare-new", "box_new")}
      </div>
      {withStats && (
        <div className="rounded-sm border border-steel bg-gunmetal/60 p-3" data-testid="stat-diff">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">What changed · read by the text reader</div>
          {diff.isLoading && <p className="font-mono text-xs text-zinc-400" data-testid="stat-diff-loading"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Reading the stats on both cards (a few seconds)…</p>}
          {diff.isError && <p className="text-xs text-red-300" data-testid="stat-diff-error">{errorMessage(diff.error, "Could not read the stats")}</p>}
          {diff.data && changed.length === 0 && <p className="text-xs text-emerald-300" data-testid="stat-diff-same">No stat or text differences found: the cards read the same.</p>}
          {changed.length > 0 && (
            <table className="w-full text-left text-xs" data-testid="stat-diff-table">
              <thead className="font-mono text-[10px] uppercase text-zinc-500"><tr><th className="py-1 pr-2">Stat</th><th className="pr-2">Library now</th><th>Incoming</th></tr></thead>
              <tbody>
                {changed.map((r, i) => (
                  <tr key={`${r.label}|${r.old}|${r.new}|${(r.box_old ?? r.box_new ?? []).join(",")}`} className="border-t border-steel/50" data-testid={`stat-diff-row-${i}`}>
                    <td className="py-1 pr-2 font-semibold text-zinc-200">{r.label}</td>
                    <td className="pr-2 font-mono text-zinc-400 line-through decoration-hazard/60">{r.old || "—"}</td>
                    <td className="font-mono text-gold">{r.new || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {diff.data && <p className="mt-2 text-[10px] text-zinc-500">Evidence only: the text reader can misread, so check the highlighted areas on the cards. It never changes manifest data.</p>}
        </div>
      )}
    </div>
  );
}

function PreviewTile({ label, value, tone, onClick, testId }: { label: string; value: number; tone: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="rounded-sm border border-steel bg-plate/70 px-3 py-2.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-teal/50">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-heading text-2xl font-black tabular-nums ${tone}`}>{value}</div>
    </button>
  );
}

export default function MatchReview() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { batch, isLoading: batchLoading } = useLatestBatch();
  const { data: matches = [], isLoading, isError } = useMatches(batch?.id, batch?.analysis_status !== "done");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [dialog, setDialog] = useState<Dlg | null>(null);
  const [note, setNote] = useState("");
  const [levelChoice, setLevelChoice] = useState<LevelDecision>("approve_70");
  const published = batch?.status === "published";
  const isAdmin = me?.role === "admin";

  const done = (label: string) => {
    BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    toast.success(label);
    setDialog(null);
    setNote("");
  };
  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: DecisionIn }) => apiPatch<Match>(`/matches/${id}`, body),
    onSuccess: (m) => done(`${m.catalog_name || m.manifest_name || "Card"} → ${m.decision.replace("_", " ")}`),
    onError: (e) => toast.error(errorMessage(e, "Could not save decision")),
  });
  const levelMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LevelDecisionIn }) => apiPost<Match>(`/matches/${id}/level-decision`, body),
    onSuccess: (m) => done(`${m.catalog_name || m.manifest_name}: ${LEVEL_DECISION_LABELS[m.level_decision ?? "approve_70"]}`),
    onError: (e) => toast.error(errorMessage(e, "Could not save level decision")),
  });

  const counts = useMemo(() => Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, matches.filter(f.test).length])), [matches]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = matches.filter(FILTERS[filter].test);
    if (filter === "all") list = [...list].sort((a, b) => Number(b.decision === "pending") - Number(a.decision === "pending") || a.index - b.index);
    if (q) list = list.filter((m) => [m.serial, m.item_key, m.catalog_name, m.manifest_name, m.file, m.image_code].some((v) => v.toLowerCase().includes(q)));
    return list;
  }, [matches, filter, search]);
  const visible = filtered.slice(0, limit);
  const pick = (f: string) => { setFilter(f); setLimit(PAGE); };

  if (!batchLoading && !batch)
    return (
      <div>
        <PageHeader kicker="Step 02" title="Import preview" />
        <EmptyState testId="review-empty" title="No batch to review" body="Upload a card export ZIP first.">
          <Link to="/import" className={buttonVariants()} data-testid="review-go-import">Go to import</Link>
        </EmptyState>
      </div>
    );

  const levelLocked = (m: Match) => published && m.level_decision !== null;

  return (
    <div>
      <PageHeader kicker="Step 02 · Dry run" title="Import preview">
        {batch && batch.pending === 0 && batch.analysis_status === "done" && !published && (
          <Link to="/export" data-testid="review-continue-export" className={buttonVariants()}>
            {isAdmin ? "Approve & apply" : "Continue to export"} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </PageHeader>

      {batch && <div className="mb-4"><AnalysisProgress batch={batch} /></div>}
      {published && (
        <div className="mb-4 rounded-sm border border-teal/40 bg-teal/5 px-4 py-3 text-sm text-teal" data-testid="review-locked-banner">
          This batch is already applied to the library. Level decisions still record outdated cards for regeneration.
        </div>
      )}

      {batch && (
        <Panel className="p-4" data-testid="preview-summary">
          <div className="mb-3 font-heading text-sm font-black uppercase text-white">What this import would do</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <PreviewTile label="New cards" value={batch.new_records} tone="text-teal" onClick={() => pick("new")} testId="preview-new" />
            <PreviewTile label="Replacements" value={batch.replacements} tone="text-white" onClick={() => pick("replacement")} testId="preview-replacements" />
            <PreviewTile label="Unmatched" value={batch.unmatched} tone="text-red-400" onClick={() => pick("unmatched")} testId="preview-unmatched" />
            <PreviewTile label="Duplicate files" value={batch.duplicate_files} tone="text-red-400" onClick={() => pick("duplicates")} testId="preview-duplicates" />
            <PreviewTile label="OCR conflicts" value={batch.ocr_conflicts} tone="text-gold" onClick={() => pick("ocr_conflict")} testId="preview-ocr-conflicts" />
            <PreviewTile label="Missing records" value={batch.missing_records} tone="text-gold" onClick={() => pick("all")} testId="preview-missing-records" />
            <PreviewTile label="Held · level" value={batch.level_held} tone="text-red-400" onClick={() => pick("level_conflict")} testId="preview-level-held" />
            <PreviewTile label="Needs decision" value={batch.pending} tone="text-gold" onClick={() => pick("manual")} testId="preview-pending" />
          </div>
          <p className="mt-3 text-xs text-zinc-400">Missing records become Card pending. Level-held cards are neither published nor used as replacements until a level decision is recorded.</p>
        </Panel>
      )}

      <div className="sticky top-14 z-10 -mx-4 mt-5 flex flex-col gap-2 border-b border-steel bg-gunmetal/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:flex-row sm:px-6">
        <Select value={filter} onValueChange={(v: string) => pick(v)}>
          <SelectTrigger className="sm:w-80" data-testid="review-filter-select">
            <SelectValue>{(v) => `${FILTERS[v as string]?.label} (${counts[v as string] ?? 0})`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FILTERS).map(([k, f]) => (
              <SelectItem key={k} value={k} data-testid={`filter-option-${k}`}>{f.label} ({counts[k] ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} placeholder="Search serial, itemKey, name, file"
          data-testid="review-search-input" className="font-mono text-xs sm:max-w-md" />
      </div>

      {isError && <p className="mt-4 text-sm text-red-300" data-testid="review-load-error">Could not load matches. Refresh to try again.</p>}
      {isLoading && <p className="mt-4 font-mono text-xs text-zinc-400">Loading matches…</p>}

      <div className="mt-4 space-y-3" data-testid="match-list">
        {visible.map((m) => {
          const hasLevelConflict = m.reasons.includes("level_conflict") || (m.level_status === "unreadable" && Boolean(m.image_id));
          const otherBlocking = m.reasons.some((r) => BLOCKING_REASONS.includes(r) && r !== "level_conflict");
          return (
            <Panel key={m.id} data-testid={`match-row-${m.index}`}
              className={`grid grid-cols-[72px_1fr] gap-4 p-3 sm:grid-cols-[88px_1fr_auto] sm:p-4 ${m.status === "exception" ? "border-l-2 border-l-hazard" : "border-l-2 border-l-emerald-500/70"}`}>
              <CardImage imageId={m.image_id} alt={m.catalog_name || m.manifest_name} />
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading text-base font-black uppercase text-white" data-testid={`match-name-${m.index}`}>{m.catalog_name || m.manifest_name || "Unknown item"}</span>
                  <DecisionBadge decision={m.decision} testId={`match-decision-${m.index}`} />
                  <span className="rounded-sm border border-steel px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">{m.change}</span>
                </div>
                <div className="flex flex-wrap gap-1.5"><SerialPill serial={m.serial} />{m.item_key && <SerialPill serial={m.item_key} className="text-zinc-300" />}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-400" data-testid={`match-filename-${m.index}`}>
                  <span>prefix <b className="text-zinc-200">{m.file_prefix || "—"}</b></span>
                  <span>item <b className="text-zinc-200">{m.file_item_name || "—"}</b></span>
                  <span>code <b className="text-zinc-200">{m.image_code ? `${m.image_code.slice(0, 10)}…` : "—"}</b></span>
                  <span>.{m.file_ext || "?"}</span>
                  <span title={m.sha256}>sha256 {m.sha256 ? `${m.sha256.slice(0, 8)}…` : "—"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LevelBadge status={m.level_status} testId={`match-level-${m.index}`} />
                  {m.level_crop_id && <img src={cardImageUrl(m.level_crop_id)} alt="OCR level crop" className="h-7 rounded-sm border border-steel" data-testid={`match-level-crop-${m.index}`} />}
                  {m.ocr_status !== "pending" && (
                    <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400" data-testid={`match-ocr-${m.index}`}>
                      <Gauge className="h-3 w-3" /> OCR “{m.ocr_level_text || "—"}” → {m.ocr_level ?? "?"} · {m.ocr_level_conf != null ? `${Math.round(m.ocr_level_conf * 100)}%` : "—"}
                      {m.ocr_name_score != null && <> · name {Math.round(m.ocr_name_score * 100)}%</>}
                    </span>
                  )}
                  {m.level_decision && <span className="font-mono text-[11px] text-teal" data-testid={`match-level-decision-${m.index}`}>{LEVEL_DECISION_LABELS[m.level_decision]} · {m.level_decided_by}</span>}
                </div>
                <ReasonBadges reasons={m.reasons} />
                {m.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1">{m.flags.map((f) => (
                    <span key={f} className="rounded-sm border border-gold/40 bg-gold/5 px-1.5 py-0.5 font-mono text-[10px] uppercase text-gold">{FLAG_LABELS[f] ?? f}</span>
                  ))}</div>
                )}
                {m.flags.includes("ocr_name_conflict") && <p className="font-mono text-[11px] text-zinc-500">OCR read: {m.ocr_name_text}</p>}
                {m.note && <p className="text-xs text-zinc-300" data-testid={`match-note-${m.index}`}>Note: {m.note}</p>}
              </div>
              <div className="col-span-2 flex flex-wrap items-start gap-2 sm:col-span-1 sm:flex-col sm:items-stretch">
                {m.compare_image_id && (
                  <Button size="sm" variant="outline" className="border-teal/40" data-testid={`compare-match-${m.index}`} onClick={() => { setNote(m.note); setDialog({ match: m, kind: "compare" }); }}>
                    <Columns2 className="h-3.5 w-3.5 text-teal" /> Compare
                  </Button>
                )}
                {hasLevelConflict && !levelLocked(m) && (
                  <Button size="sm" data-testid={`level-decide-${m.index}`} onClick={() => { setLevelChoice(m.level_decision ?? "approve_70"); setNote(""); setDialog({ match: m, kind: "level" }); }}>
                    Level decision
                  </Button>
                )}
                {!published && m.status === "exception" && m.decision !== "approved" && !(hasLevelConflict && !m.level_decision) && (
                  <Button size="sm" variant="outline" disabled={otherBlocking || decide.isPending} data-testid={`approve-match-${m.index}`} onClick={() => { setNote(m.note); setDialog({ match: m, kind: "approve" }); }}>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Approve
                  </Button>
                )}
                {!published && m.decision !== "rejected" && (
                  <Button size="sm" variant="outline" disabled={decide.isPending} data-testid={`reject-match-${m.index}`} onClick={() => { setNote(m.note); setDialog({ match: m, kind: "reject" }); }}>
                    <X className="h-3.5 w-3.5 text-red-400" /> Reject
                  </Button>
                )}
                {!published && m.status === "exception" && m.decision !== "pending" && !m.level_decision && (
                  <Button size="sm" variant="ghost" disabled={decide.isPending} data-testid={`reset-match-${m.index}`} onClick={() => decide.mutate({ id: m.id, body: { decision: "pending", note: "" } })}>
                    <RotateCcw className="h-3.5 w-3.5" /> Undo
                  </Button>
                )}
                {!published && m.status === "clean" && m.decision === "rejected" && (
                  <Button size="sm" variant="ghost" disabled={decide.isPending} data-testid={`restore-match-${m.index}`} onClick={() => decide.mutate({ id: m.id, body: { decision: "approved", note: "" } })}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
        {filtered.length > visible.length && (
          <div className="flex flex-col items-center gap-2 py-4">
            <span className="font-mono text-xs text-zinc-400" data-testid="review-showing-count">Showing {visible.length} of {filtered.length}</span>
            <Button variant="outline" data-testid="review-show-more" onClick={() => setLimit((l) => l + PAGE * 3)}>Show more</Button>
          </div>
        )}
        {!isLoading && visible.length === 0 && <p className="py-8 text-center text-sm text-zinc-400" data-testid="filter-empty">Nothing in this view.</p>}
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog?.kind === "compare" ? (
          <DialogContent className="sm:max-w-3xl" data-testid="compare-dialog">
            <DialogHeader>
              <DialogTitle className="font-heading uppercase">Compare cards</DialogTitle>
              <DialogDescription>
                {dialog.match.catalog_name || dialog.match.manifest_name}: the card the library shows on the left, the {published ? "card this import applied" : "incoming card"} on the right.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <SerialPill serial={dialog.match.serial} />
              <DecisionBadge decision={dialog.match.decision} />
              <LevelBadge status={dialog.match.level_status} />
            </div>
            <div className="max-h-[65vh] overflow-y-auto"><CompareView m={dialog.match} published={published} withStats /></div>
            <DialogFooter>
              <Button variant="outline" data-testid="compare-close" onClick={() => setDialog(null)}>Close</Button>
              {!published && dialog.match.decision !== "rejected" && (
                <Button variant="destructive" data-testid="compare-reject" onClick={() => setDialog({ match: dialog.match, kind: "reject" })}>
                  <X className="h-4 w-4" /> Keep current card
                </Button>
              )}
              {!published && dialog.match.status === "exception" && dialog.match.decision !== "approved"
                && !(dialog.match.reasons.includes("level_conflict") && !dialog.match.level_decision)
                && !dialog.match.reasons.some((r) => BLOCKING_REASONS.includes(r) && r !== "level_conflict") && (
                <Button data-testid="compare-approve" onClick={() => setDialog({ match: dialog.match, kind: "approve" })}>
                  <Check className="h-4 w-4" /> Approve replacement
                </Button>
              )}
              {!published && dialog.match.status === "clean" && dialog.match.decision === "rejected" && (
                <Button data-testid="compare-restore" disabled={decide.isPending} onClick={() => decide.mutate({ id: dialog.match.id, body: { decision: "approved", note: "" } })}>
                  <Check className="h-4 w-4" /> Use incoming card
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        ) : (
        <DialogContent data-testid="decision-dialog">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase">
              {dialog?.kind === "level" ? "Level decision" : dialog?.kind === "approve" ? "Approve exception" : "Reject card"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "level"
                ? "The validated manifest says level 70, but OCR read something else. Nothing is published or replaced until you record a decision. Your decision goes in the audit log."
                : dialog?.kind === "approve" ? "This card will be used even though it failed a check. Explain why." : "This card is left out; the library keeps its current image."}
            </DialogDescription>
          </DialogHeader>
          {dialog && (
            <div className="space-y-3">
              {dialog.match.compare_image_id && <CompareView m={dialog.match} published={published} />}
              <div className="flex items-center gap-3">
                {dialog.match.level_crop_id && <img src={cardImageUrl(dialog.match.level_crop_id)} alt="level crop" className="h-10 rounded-sm border border-steel" />}
                <div className="font-mono text-xs text-zinc-300">
                  OCR level {dialog.match.ocr_level ?? "?"} · confidence {dialog.match.ocr_level_conf != null ? `${Math.round(dialog.match.ocr_level_conf * 100)}%` : "—"}
                </div>
              </div>
              <SerialPill serial={dialog.match.serial} />
              {dialog.kind === "level" && (
                <div className="grid gap-2" data-testid="level-options">
                  {(["approve_70", "ocr_misread", "require_regeneration"] as LevelDecision[]).map((d) => (
                    <button key={d} type="button" data-testid={`level-option-${d}`} onClick={() => setLevelChoice(d)}
                      className={`rounded-sm border px-3 py-2 text-left text-sm transition-colors ${levelChoice === d ? "border-teal bg-teal/10 text-white" : "border-steel text-zinc-300 hover:border-teal/40"}`}>
                      <div className="font-semibold">{d === "approve_70" ? "Approve as level 70" : d === "ocr_misread" ? "Mark OCR misread" : "Require level-70 regeneration"}</div>
                      <div className="text-xs text-zinc-400">
                        {d === "approve_70" ? "The card image is the correct level-70 card." : d === "ocr_misread" ? "The card shows 70; OCR read it wrong." : "The image is outdated. Hold it, mark the record for a level-70 card refresh, and keep it out of the library."}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="decision-note">{dialog.kind === "approve" ? "Reason (required)" : "Note (optional)"}</Label>
                <Textarea id="decision-note" data-testid="decision-note-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" data-testid="decision-cancel" onClick={() => setDialog(null)}>Cancel</Button>
            <Button data-testid="decision-confirm" variant={dialog?.kind === "reject" ? "destructive" : "default"}
              disabled={decide.isPending || levelMut.isPending || (dialog?.kind === "approve" && !note.trim())}
              onClick={() => {
                if (!dialog) return;
                if (dialog.kind === "level") levelMut.mutate({ id: dialog.match.id, body: { decision: levelChoice, note } });
                else decide.mutate({ id: dialog.match.id, body: { decision: dialog.kind === "approve" ? "approved" : "rejected", note } });
              }}>
              Save decision
            </Button>
          </DialogFooter>
        </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
