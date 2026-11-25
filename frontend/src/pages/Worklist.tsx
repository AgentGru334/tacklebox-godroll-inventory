import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Download, Share2, Copy, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, PageHeader, Panel, SerialPill } from "@/components/injector/ui";
import { LevelBadge, ProgressBar } from "@/components/injector/progress";
import { RegenBadge } from "@/components/injector/flags";
import { qk, useLatestBatch, useMatches, useMe } from "@/hooks/useInjector";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/api";
import { REGEN_LABELS } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import type { CatalogItem, Match, RegenStatus, ShareIn, ShareStatus, WorklistStatusIn } from "@/lib/types";

const MANUAL: WorklistStatusIn["status"][] = ["pending", "in_progress", "regenerated"];
const ORDER: RegenStatus[] = ["pending", "in_progress", "regenerated", "verified", "published"];

interface Row {
  id: string | null; // catalog id; null = awaiting a level decision in the import preview
  name: string; serial: string; itemKey: string; type: string; ocr: string;
  level: Match["level_status"] | null; status: RegenStatus | null; by: string | null;
}

const groupBy = <T extends { name: string }>(list: T[]) => {
  const g = new Map<string, T[]>();
  for (const r of list) g.set(r.name, [...(g.get(r.name) ?? []), r]);
  return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function SharePanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: qk.share, queryFn: () => apiGet<ShareStatus>("/worklist/share") });
  const mut = useMutation({
    mutationFn: (b: ShareIn) => apiPost<ShareStatus>("/worklist/share", b),
    onSuccess: (s) => { qc.setQueryData(qk.share, s); toast.success(s.enabled ? "Share link is on" : "Share link turned off: the old link no longer opens"); },
    onError: (e) => toast.error(errorMessage(e, "Could not update the share link")),
  });
  const url = data?.token ? `${window.location.origin}/share/worklist#${data.token}` : "";
  return (
    <Panel className="mb-4 flex flex-col gap-2 p-4 print:hidden sm:flex-row sm:items-center" data-testid="share-panel">
      <Share2 className="h-5 w-5 shrink-0 text-teal" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">Read-only share link {data?.enabled ? <span className="ml-1 font-mono text-[10px] uppercase text-emerald-300">on</span> : <span className="ml-1 font-mono text-[10px] uppercase text-zinc-500">off</span>}</div>
        {url ? <div className="truncate font-mono text-[11px] text-zinc-400" data-testid="share-url">{url}</div>
          : <div className="text-xs text-zinc-500">Anyone with the link sees names, serials and statuses. No sign-in, no images, no admin data.</div>}
      </div>
      {data?.enabled && url && (
        <>
          <Button size="sm" variant="outline" data-testid="share-copy" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied"), () => toast.error("Copy failed: select the link and copy it"))}><Copy className="h-3.5 w-3.5" /> Copy</Button>
          <Button size="sm" variant="ghost" disabled={mut.isPending} data-testid="share-regenerate" onClick={() => mut.mutate({ enabled: true, regenerate: true })}><RefreshCw className="h-3.5 w-3.5" /> New link</Button>
        </>
      )}
      <Button size="sm" variant={data?.enabled ? "destructive" : "default"} disabled={mut.isPending || !data} data-testid="share-toggle" onClick={() => mut.mutate({ enabled: !data?.enabled, regenerate: false })}>
        {data?.enabled ? "Turn off" : "Turn on link"}
      </Button>
    </Panel>
  );
}

function LinkTab({ items }: { items: CatalogItem[] }) {
  const rows = items.filter((i) => i.stale_reasons.includes("needs_link"));
  const groups = groupBy(rows);
  return (
    <div data-testid="needs-link-tab">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <span className="font-mono text-xs text-zinc-300" data-testid="needs-link-count"><b className="text-gold">{rows.length}</b> records · {groups.length} item names</span>
        <div className="flex gap-2">
          <Link to="/links" className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="needs-link-open-queue">Open link queue</Link>
          <Button size="sm" variant="outline" disabled={!rows.length} data-testid="needs-link-csv"
            onClick={() => downloadCsv("needs-website-link.csv", ["name", "serial", "itemKey", "type", "card"], rows.map((r) => [r.name, r.serial, r.item_key, r.item_type, r.card_state]))}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" disabled={!rows.length} onClick={() => window.print()} data-testid="needs-link-print"><Printer className="h-3.5 w-3.5" /> Print</Button>
        </div>
      </div>
      <p className="mb-4 hidden text-sm print:block">Needs website link: {rows.length} records · printed {new Date().toLocaleString()}</p>
      {rows.length === 0 && <EmptyState testId="needs-link-empty" title="Every record is linked" body="Each record points at a God Roll website item." />}
      <div className="columns-1 gap-6 md:columns-2 print:columns-2">
        {groups.map(([name, list]) => (
          <section key={name} className="mb-3 break-inside-avoid" data-testid={`needs-link-group-${slug(name)}`}>
            <h3 className="border-b border-steel pb-0.5 font-heading text-sm font-black uppercase text-white print:border-black print:text-black">{name} <span className="font-mono text-[10px] text-gold print:text-black">×{list.length}</span></h3>
            {list.map((i) => <div key={i.id} className="mt-1"><SerialPill serial={i.serial} className="print:border-black print:bg-white print:text-black" /></div>)}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function Worklist() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const { data: items = [], isLoading } = useQuery({ queryKey: qk.catalog, queryFn: () => apiGet<CatalogItem[]>("/catalog") });
  const { batch } = useLatestBatch();
  const { data: matches = [] } = useMatches(batch?.id);
  const [tab, setTab] = useState<"level" | "link">("level");
  const [hidePublished, setHidePublished] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorklistStatusIn["status"] }) => apiPatch<CatalogItem>(`/worklist/${id}/status`, { status } satisfies WorklistStatusIn),
    onSuccess: (it) => {
      qc.setQueryData<CatalogItem[]>(qk.catalog, (old) => old?.map((o) => (o.id === it.id ? it : o)));
      qc.invalidateQueries({ queryKey: qk.audit });
      toast.success(`${it.name}: ${REGEN_LABELS[it.regen_status ?? "pending"]}`);
    },
    onError: (e) => toast.error(errorMessage(e, "Could not update the status")),
  });

  const all = useMemo(() => {
    const out: Row[] = items.filter((i) => i.needs_level70_refresh || i.regen_status === "published").map((i) => ({
      id: i.id, name: i.name, serial: i.serial, itemKey: i.item_key, type: i.item_type, ocr: i.level_status ?? "",
      level: i.level_status, status: i.regen_status ?? "pending", by: i.regen_status_by,
    }));
    const seen = new Set(out.map((r) => r.serial));
    for (const m of matches) {
      if (m.reasons.includes("level_conflict") && !m.level_decision && !seen.has(m.serial)) {
        out.push({ id: null, name: m.catalog_name || m.manifest_name, serial: m.serial, itemKey: m.item_key, type: m.item_type,
          ocr: `OCR ${m.ocr_level ?? "?"} (${m.ocr_level_conf != null ? Math.round(m.ocr_level_conf * 100) : "?"}%)`, level: m.level_status, status: null, by: null });
      }
    }
    return out;
  }, [items, matches]);
  const counts = Object.fromEntries(ORDER.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<RegenStatus, number>;
  const awaiting = all.filter((r) => !r.status).length;
  const left = all.length - counts.published;
  const shown = all.filter((r) => !(hidePublished && r.status === "published") && (statusFilter === "all" || (statusFilter === "awaiting" ? !r.status : r.status === statusFilter)));
  const groups = useMemo(() => groupBy(shown), [shown]);
  const csv = () => downloadCsv("level70-regeneration-worklist.csv", ["name", "serial", "itemKey", "type", "status", "updated_by", "ocr"],
    all.map((r) => [r.name, r.serial, r.itemKey, r.type, r.status ? REGEN_LABELS[r.status] : "Awaiting level decision", r.by ?? "", r.ocr]));

  return (
    <div className="print:text-black">
      <div className="print:hidden">
        <PageHeader kicker="Regeneration" title="Worklists">
          {tab === "level" && <>
            <Button variant="outline" disabled={!all.length} onClick={csv} data-testid="worklist-csv-button"><Download className="h-4 w-4" /> CSV</Button>
            <Button disabled={!all.length} onClick={() => window.print()} data-testid="worklist-print-button"><Printer className="h-4 w-4" /> Print</Button>
          </>}
        </PageHeader>
        <div className="mb-4 flex gap-1 border-b border-steel" role="tablist">
          {([["level", `Level 70 refresh (${all.length})`], ["link", `Needs website link (${items.filter((i) => i.stale_reasons.includes("needs_link")).length})`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} data-testid={`worklist-tab-${k}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 ${tab === k ? "border-gold text-white" : "border-transparent text-zinc-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "link" ? <LinkTab items={items} /> : (
        <>
          <p className="-mt-1 mb-4 max-w-3xl text-sm text-zinc-400 print:hidden">
            Cards to regenerate in NCS Lookup at level 70, grouped by item name. You set Pending, In progress and Regenerated. <b className="text-emerald-300">Verified</b> is set when an imported card for that serial is OCR-confirmed at level 70, and <b className="text-emerald-300">Published</b> when that import is applied.
          </p>
          {isAdmin && <SharePanel />}
          <div className="hidden print:mb-4 print:block">
            <h1 className="text-2xl font-bold">Tacklebox: level-70 regeneration worklist</h1>
            <p className="text-sm">{all.length} cards · {counts.published} published · {left} left · printed {new Date().toLocaleString()}</p>
          </div>
          {isLoading && <p className="font-mono text-xs text-zinc-400">Loading…</p>}
          {!isLoading && all.length === 0 && (
            <EmptyState testId="worklist-empty" title="Nothing to regenerate" body="No card is marked for a level-70 refresh, and no level conflict is waiting for a decision." />
          )}
          {all.length > 0 && (
            <div className="mb-4 rounded-sm border border-steel bg-plate/60 p-4 print:hidden" data-testid="worklist-progress">
              <ProgressBar value={counts.published} max={all.length} label={`${counts.published} of ${all.length} published`} testId="worklist-progress-bar" tone="gold" />
              <div className="mt-3 flex flex-wrap gap-1.5" data-testid="worklist-status-counts">
                {ORDER.map((s) => (
                  <button key={s} type="button" onClick={() => setStatusFilter(statusFilter === s ? "all" : s)} data-testid={`worklist-count-${s}`}
                    className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors duration-150 ${statusFilter === s ? "border-gold bg-gold/10 text-gold" : "border-steel text-zinc-300 hover:border-gold/40"}`}>
                    {REGEN_LABELS[s]} · {counts[s]}
                  </button>
                ))}
                {awaiting > 0 && <button type="button" onClick={() => setStatusFilter(statusFilter === "awaiting" ? "all" : "awaiting")} className={`rounded-sm border px-2 py-1 font-mono text-[11px] ${statusFilter === "awaiting" ? "border-gold text-gold" : "border-dashed border-steel text-zinc-400"}`} data-testid="worklist-count-awaiting">Awaiting level decision · {awaiting}</button>}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-zinc-300" data-testid="worklist-left"><b className="text-gold">{left}</b> left · {groups.length} item names shown</span>
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <Checkbox checked={hidePublished} onCheckedChange={(c) => setHidePublished(Boolean(c))} data-testid="worklist-hide-published" /> Hide published
                </label>
              </div>
            </div>
          )}
          <div className="space-y-5" data-testid="worklist-groups">
            {groups.map(([name, list]) => (
              <section key={name} className="break-inside-avoid" data-testid={`worklist-group-${slug(name)}`}>
                <h2 className="border-b border-steel pb-1 font-heading text-lg font-black uppercase text-white print:border-black print:text-black">
                  {name} <span className="font-mono text-xs text-gold print:text-black">{list.filter((r) => r.status === "published").length}/{list.length}</span>
                </h2>
                <table className="mt-1 w-full text-left text-sm">
                  <thead className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 print:text-black">
                    <tr><th className="py-1 pr-2">Status</th><th className="pr-2">Serial</th><th className="pr-2">itemKey</th><th className="pr-2">Type</th><th>Evidence</th></tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const locked = r.status === "verified" || r.status === "published";
                      return (
                        <tr key={r.serial} className={`border-t border-steel/50 print:border-black/30 ${r.status === "published" ? "opacity-60" : ""}`} data-testid={`worklist-row-${r.serial}`}>
                          <td className="py-1.5 pr-2">
                            {r.id && r.status && !locked ? (
                              <span className="print:hidden">
                                <Select value={r.status} onValueChange={(v: string) => setStatus.mutate({ id: r.id!, status: v as WorklistStatusIn["status"] })}>
                                  <SelectTrigger size="sm" className="h-7 w-36 text-xs" data-testid={`worklist-status-${r.serial}`}><SelectValue>{(v) => REGEN_LABELS[v as RegenStatus]}</SelectValue></SelectTrigger>
                                  <SelectContent>{MANUAL.map((s) => <SelectItem key={s} value={s} data-testid={`worklist-status-option-${s}`}>{REGEN_LABELS[s]}</SelectItem>)}</SelectContent>
                                </Select>
                              </span>
                            ) : r.status ? <span className="print:hidden"><RegenBadge status={r.status} testId={`worklist-badge-${r.serial}`} /></span>
                              : <Link to="/review" className="font-mono text-[11px] text-gold underline-offset-2 hover:underline print:hidden">Needs level decision</Link>}
                            <span className="hidden print:inline">{r.status ? `☐ ${REGEN_LABELS[r.status]}` : "☐ Awaiting decision"}</span>
                            {r.by && <div className="truncate font-mono text-[9px] text-zinc-500 print:text-black" title={r.by}>{r.by}</div>}
                          </td>
                          <td className="pr-2"><SerialPill serial={r.serial} className="print:border-black print:bg-white print:text-black" /></td>
                          <td className="pr-2 font-mono text-[11px] text-zinc-300 print:text-black">{r.itemKey}</td>
                          <td className="pr-2 text-zinc-300 print:text-black">{r.type}</td>
                          <td className="font-mono text-[11px] text-zinc-400 print:text-black">{r.level ? <span className="print:hidden"><LevelBadge status={r.level} /></span> : null} <span className="hidden print:inline">{r.ocr}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
