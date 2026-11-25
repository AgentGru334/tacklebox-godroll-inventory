import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Crosshair, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SerialPill } from "@/components/injector/ui";
import { RegenBadge } from "@/components/injector/flags";
import { apiGetPublic, apiPostPublic, errorMessage } from "@/lib/api";
import { REGEN_LABELS } from "@/lib/types";
import type { PublicStatusIn, PublicWorklist, PublicWorklistRow } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";

/** Public, read-only. No sign-in, no images, no internal warnings. */
export default function SharedWorklist() {
  // the token sits after "#": browsers never send that part to any server or in referrers
  const token = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const auth = { "X-Share-Token": token };
  const qc = useQueryClient();
  const key = ["public-worklist", token];
  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => apiGetPublic<PublicWorklist>("/public/worklist", auth), retry: false, enabled: Boolean(token) });
  const [name, setName] = useState(() => localStorage.getItem("tb-share-name") ?? "");
  const mark = useMutation({
    mutationFn: (serial: string) => apiPostPublic<PublicWorklistRow>("/public/worklist/status", { serial, status: "in_progress", name: name.trim() } satisfies PublicStatusIn, auth),
    onSuccess: (r) => {
      localStorage.setItem("tb-share-name", name.trim());
      qc.setQueryData<PublicWorklist>(key, (old) => old && { ...old, rows: old.rows.map((x) => (x.serial === r.serial ? r : x)) });
      toast.success(`${r.name} marked In progress`);
    },
    onError: (e) => { toast.error(errorMessage(e, "Could not update")); qc.invalidateQueries({ queryKey: key }); },
  });
  const nameOk = name.trim().length >= 2;
  const rows = data?.rows ?? [];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  const left = rows.filter((r) => r.status !== "published").length;

  return (
    <div className="mx-auto min-h-dvh max-w-4xl px-4 py-8 print:text-black">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="chamfer grid h-9 w-9 place-items-center bg-gold text-[#1C1100] print:hidden"><Crosshair className="h-5 w-5" strokeWidth={2.5} /></div>
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal print:text-black">Tacklebox · read-only</div>
          <h1 className="font-heading text-2xl font-black uppercase text-white print:text-black">Level-70 regeneration list</h1>
        </div>
        {rows.length > 0 && (
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="outline" data-testid="shared-csv"
              onClick={() => downloadCsv("level70-worklist.csv", ["name", "serial", "itemKey", "type", "status"], rows.map((r) => [r.name, r.serial, r.item_key, r.item_type, REGEN_LABELS[r.status]]))}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button size="sm" onClick={() => window.print()} data-testid="shared-print"><Printer className="h-3.5 w-3.5" /> Print</Button>
          </div>
        )}
      </header>
      {isLoading && <p className="font-mono text-xs text-zinc-400">Loading…</p>}
      {(isError || !token) && <p className="rounded-sm border border-steel p-4 text-sm text-zinc-300" data-testid="shared-unavailable">This share link is off or no longer valid. Ask the Tacklebox admin for a new one.</p>}
      {data && (
        <>
          <p className="mb-4 font-mono text-xs text-zinc-400 print:text-black" data-testid="shared-summary">
            {rows.length} cards · {left} still to regenerate · updated {new Date(data.generated_at).toLocaleString()}
          </p>
          {rows.some((r) => r.status === "pending") && (
            <div className="mb-5 rounded-sm border border-steel bg-plate/60 p-3 print:hidden" data-testid="shared-name-panel">
              <Label htmlFor="share-name" className="text-xs text-zinc-300">Your name (needed to mark a card In progress)</Label>
              <Input id="share-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Moxxi" className="mt-1 max-w-xs" data-testid="shared-name-input" />
              <p className="mt-1 text-[11px] text-zinc-500">You can only mark Pending cards as In progress. Every change is logged with your name.</p>
            </div>
          )}
          {rows.length === 0 && <p className="text-sm text-zinc-300" data-testid="shared-empty">Nothing to regenerate right now.</p>}
          <div className="space-y-4" data-testid="shared-groups">
            {[...groups.entries()].map(([name, list]) => (
              <section key={name} className="break-inside-avoid">
                <h2 className="border-b border-steel pb-1 font-heading text-lg font-black uppercase text-white print:border-black print:text-black">{name}</h2>
                {list.map((r) => (
                  <div key={r.serial} className="flex flex-wrap items-center gap-2 border-t border-steel/40 py-1.5 first:border-t-0" data-testid={`shared-row-${r.serial}`}>
                    <span className="print:hidden"><RegenBadge status={r.status} /></span>
                    <span className="hidden print:inline">☐ {REGEN_LABELS[r.status]}</span>
                    <SerialPill serial={r.serial} className="print:border-black print:bg-white print:text-black" />
                    <span className="font-mono text-[11px] text-zinc-400 print:text-black">{r.item_type}</span>
                    {r.by && <span className="font-mono text-[10px] text-zinc-500" data-testid={`shared-by-${r.serial}`}>{r.by}</span>}
                    {r.status === "pending" && (
                      <Button size="xs" variant="outline" className="ml-auto print:hidden" disabled={!nameOk || mark.isPending} title={nameOk ? "" : "Type your name first"}
                        onClick={() => mark.mutate(r.serial)} data-testid={`shared-mark-${r.serial}`}>Mark in progress</Button>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
