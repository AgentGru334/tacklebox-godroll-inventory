import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Lightbulb, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, PageHeader, Panel, SerialPill, Stat } from "@/components/injector/ui";
import { BATCH_KEYS, qk, useMe } from "@/hooks/useInjector";
import { apiGet, apiPost, errorMessage } from "@/lib/api";
import type { BulkAcceptIn, BulkAcceptResult, LinkResult, UnlinkedItem } from "@/lib/types";

const PAGE = 50;
const CONF: Record<string, { label: string; tone: string; test: (r: UnlinkedItem) => boolean }> = {
  all: { label: "All unlinked", tone: "", test: () => true },
  high: { label: "High confidence", tone: "border-emerald-500/60 text-emerald-300", test: (r) => r.confidence === "high" },
  medium: { label: "Medium confidence", tone: "border-gold/60 text-gold", test: (r) => r.confidence === "medium" },
  low: { label: "Low confidence", tone: "border-zinc-500 text-zinc-300", test: (r) => r.confidence === "low" },
  none: { label: "No suggestion", tone: "", test: (r) => !r.suggestion },
};
const BASIS: Record<string, string> = { item_key: "Exact itemKey", image_code: "Exact image code", name: "Name match", none: "" };

export default function Links() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const { data: rows = [], isLoading, isError } = useQuery({ queryKey: qk.unlinked, queryFn: () => apiGet<UnlinkedItem[]>("/site/unlinked") });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [q, setQ] = useState("");
  const [conf, setConf] = useState("all");
  const [limit, setLimit] = useState(PAGE);

  const done = () => { BATCH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k })); setSelected(new Set()); };
  const link = useMutation({
    mutationFn: ({ ids, site }: { ids: string[]; site: string }) => apiPost<LinkResult>("/site/link", { catalog_item_ids: ids, site_item: site }),
    onSuccess: (r) => { done(); setTarget(""); toast.success(`Linked ${r.linked} record(s) to “${r.site_item.item_name}”.`); },
    onError: (e) => toast.error(errorMessage(e, "Link failed")),
  });
  const bulk = useMutation({
    mutationFn: (body: BulkAcceptIn) => apiPost<BulkAcceptResult>("/site/links/accept", body),
    onSuccess: (r) => {
      done();
      if (r.linked) toast.success(`Accepted ${r.linked} high-confidence link(s).${r.skipped ? ` ${r.skipped} skipped: not high confidence.` : ""}`);
      else toast.info(r.skipped ? `Nothing accepted: ${r.skipped_reasons[0]}${r.skipped > 1 ? ` (+${r.skipped - 1} more)` : ""}` : "No high-confidence suggestions to accept.");
    },
    onError: (e) => toast.error(errorMessage(e, "Bulk accept failed")),
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => CONF[conf].test(r) && (!s || [r.item.name, r.item.serial, r.item.item_key, r.suggestion?.item_name ?? ""].some((v) => v.toLowerCase().includes(s))));
  }, [rows, q, conf]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const count = (k: string) => rows.filter(CONF[k].test).length;
  const high = count("high");
  const selectedHigh = rows.filter((r) => selected.has(r.item.id) && r.confidence === "high").length;
  const filteredHigh = filtered.filter((r) => r.confidence === "high");
  // same-name rolls that share the same suggested website item: confirm them together
  const groupOf = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const r of rows) if (r.suggestion) {
      const k = `${r.item.name}\u0000${r.suggestion.item_id}`;
      g.set(k, [...(g.get(k) ?? []), r.item.id]);
    }
    return g;
  }, [rows]);

  return (
    <div>
      <PageHeader kicker="Website" title="Unlinked queue" />
      <p className="-mt-3 mb-5 max-w-3xl text-sm text-zinc-400">
        Records with no God Roll website item yet. An exact serial match links automatically. Every other suggestion shows why it was made. <b className="text-emerald-300">High confidence</b> means an exact itemKey or image-code match with no conflicting name, manufacturer or existing link, and only those can be bulk-accepted. Name matches always need a person to confirm them one at a time.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Unlinked" value={rows.length} tone="gold" testId="unlinked-total" />
        <Stat label="High confidence" value={high} tone="green" testId="unlinked-high" />
        <Stat label="Name suggestions" value={count("medium") + count("low")} tone="teal" testId="unlinked-suggested" />
        <Stat label="Selected" value={selected.size} testId="unlinked-selected" />
      </div>

      {isAdmin && (
        <Panel className="mt-5 space-y-3 p-4" data-testid="bulk-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <span className="flex items-center gap-1.5 font-heading text-sm font-black uppercase text-white"><Zap className="h-4 w-4 text-emerald-300" /> Bulk accept</span>
            <Button size="sm" variant="outline" disabled={selectedHigh === 0 || bulk.isPending} data-testid="bulk-accept-checked"
              onClick={() => bulk.mutate({ mode: "selected", catalog_item_ids: [...selected] })}>Accept checked · high only ({selectedHigh})</Button>
            <Button size="sm" variant="outline" disabled={filteredHigh.length === 0 || bulk.isPending} data-testid="bulk-accept-filtered"
              onClick={() => bulk.mutate({ mode: "selected", catalog_item_ids: filteredHigh.map((r) => r.item.id) })}>Accept high in this view ({filteredHigh.length})</Button>
            <Button size="sm" disabled={high === 0 || bulk.isPending} data-testid="bulk-accept-all-high" onClick={() => bulk.mutate({ mode: "all_high", catalog_item_ids: [] })}>
              Accept all high confidence ({high})
            </Button>
          </div>
          {high === 0 && !isLoading && (
            <p className="text-xs text-zinc-500" data-testid="bulk-none-high">No high-confidence matches right now: no itemKey from the codes file or an uploaded itemKey map matches an unlinked record. Upload an itemKey map on the Import page, use the name suggestions below, or link by website item ID.</p>
          )}
          <div className="flex flex-col gap-2 border-t border-steel/60 pt-3 sm:flex-row sm:items-center">
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Website item ID or URL" className="font-mono sm:max-w-sm" data-testid="bulk-link-input" />
            <Button disabled={!target.trim() || selected.size === 0 || link.isPending} data-testid="bulk-link-button" onClick={() => link.mutate({ ids: [...selected], site: target })}>
              <Link2 className="h-4 w-4" /> Link {selected.size} checked to this item
            </Button>
          </div>
        </Panel>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Select value={conf} onValueChange={(v: string) => { setConf(v); setLimit(PAGE); }}>
          <SelectTrigger className="sm:w-64" data-testid="unlinked-confidence-filter"><SelectValue>{(v) => `${CONF[v as string]?.label} (${count(v as string)})`}</SelectValue></SelectTrigger>
          <SelectContent>{Object.entries(CONF).map(([k, c]) => <SelectItem key={k} value={k} data-testid={`confidence-option-${k}`}>{c.label} ({count(k)})</SelectItem>)}</SelectContent>
        </Select>
        <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Filter by name, serial, itemKey" className="sm:max-w-xs" data-testid="unlinked-search-input" />
        {isAdmin && filtered.length > 0 && (
          <Button variant="ghost" size="sm" data-testid="unlinked-select-view" onClick={() => setSelected(new Set(filtered.map((r) => r.item.id)))}>Check all in view ({filtered.length})</Button>
        )}
      </div>

      {isError && <p className="mt-4 text-sm text-red-300" data-testid="unlinked-load-error">Could not load the queue.</p>}
      {isLoading && <p className="mt-4 font-mono text-xs text-zinc-400">Scoring suggestions…</p>}
      {!isLoading && rows.length === 0 && !isError && <div className="mt-5"><EmptyState testId="unlinked-empty" title="Everything is linked" body="Every record points at a website item." /></div>}

      <div className="mt-4 space-y-2" data-testid="unlinked-list">
        {filtered.slice(0, limit).map((r) => (
          <Panel key={r.item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid={`unlinked-row-${r.item.id}`}>
            {isAdmin && <Checkbox checked={selected.has(r.item.id)} onCheckedChange={() => toggle(r.item.id)} data-testid={`unlinked-select-${r.item.id}`} />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-white">{r.item.name}</div>
              <div className="flex flex-wrap gap-1.5"><SerialPill serial={r.item.serial} />{r.item.item_key && <SerialPill serial={r.item.item_key} className="text-zinc-300" />}</div>
            </div>
            {r.suggestion ? (
              <div className="flex items-center gap-2 text-xs sm:max-w-md" data-testid={`unlinked-suggestion-${r.item.id}`}>
                <Lightbulb className="h-4 w-4 shrink-0 text-gold" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.confidence && <span className={`rounded-sm border px-1 font-mono text-[9px] uppercase ${CONF[r.confidence].tone}`} data-testid={`unlinked-confidence-${r.item.id}`}>{r.confidence}</span>}
                    <span className="font-mono text-[10px] uppercase text-zinc-500">{BASIS[r.suggestion_basis]}</span>
                  </div>
                  <div className="truncate text-zinc-200">{r.suggestion.item_name} <span className="font-mono text-zinc-500">#{r.suggestion.item_id}</span></div>
                  <div className="text-zinc-500" data-testid={`unlinked-reason-${r.item.id}`}>Why: {r.suggestion_reason}</div>
                  {r.conflicts.length > 0 && <div className="text-gold/90" data-testid={`unlinked-conflicts-${r.item.id}`}>Check: {r.conflicts.join("; ")}</div>}
                </div>
                {isAdmin && (() => {
                  const group = groupOf.get(`${r.item.name}\u0000${r.suggestion!.item_id}`) ?? [r.item.id];
                  return (
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="sm" variant="outline" disabled={link.isPending} data-testid={`accept-suggestion-${r.item.id}`}
                        onClick={() => link.mutate({ ids: [r.item.id], site: r.suggestion!.item_id })}>Confirm</Button>
                      {group.length > 1 && (
                        <Button size="sm" variant="ghost" className="text-teal" disabled={link.isPending} data-testid={`accept-group-${r.item.id}`}
                          title={`Link every unlinked “${r.item.name}” roll to ${r.suggestion!.item_name}`}
                          onClick={() => link.mutate({ ids: group, site: r.suggestion!.item_id })}>Confirm all {group.length} rolls</Button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : <span className="font-mono text-[11px] text-zinc-500">No suggestion</span>}
          </Panel>
        ))}
      </div>
      {filtered.length > limit && <div className="mt-4 flex justify-center"><Button variant="outline" data-testid="unlinked-show-more" onClick={() => setLimit((l) => l + PAGE * 3)}>Show more ({filtered.length - limit} left)</Button></div>}
    </div>
  );
}
