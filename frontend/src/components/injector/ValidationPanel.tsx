import { Panel, SerialPill, Stat } from "@/components/injector/ui";
import type { ValidationReport } from "@/lib/types";

/** Pre-publish validation summary + the cards that are blocked or only warned. */
export function ValidationPanel({ v }: { v: ValidationReport }) {
  return (
    <Panel className="mt-6 p-5" data-testid="validation-panel">
      <h2 className="font-heading text-lg font-black uppercase text-white">Pre-publish validation</h2>
      <p className="mt-1 text-sm text-zinc-400">A card goes public only if it's level 70, passed verification (OCR or a level decision), has no uncertain code and isn't quarantined. Blocked cards stay out of the library when you apply. A missing website link is only a warning, and the record lands in the Needs website link worklist.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Would publish" value={v.would_publish} testId="validation-total" />
        <Stat label="Pass" value={v.publishable} tone="green" testId="validation-pass" />
        <Stat label="Blocked" value={v.blocked} tone="red" testId="validation-blocked" />
        <Stat label="Warnings only" value={v.warnings} tone="gold" testId="validation-warnings" />
      </div>
      {v.rows.length > 0 && (
        <div className="mt-4 max-h-80 divide-y divide-steel overflow-y-auto" data-testid="validation-rows">
          {v.rows.slice(0, 200).map((r) => (
            <div key={r.match_id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`validation-row-${r.serial}`}>
              <div className="min-w-0"><span className="font-semibold text-white">{r.name}</span> <SerialPill serial={r.serial} /></div>
              <div className="flex flex-wrap gap-1">
                {r.blockers.map((b) => <span key={b} className="rounded-sm border border-hazard/50 bg-hazard/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">✕ {b}</span>)}
                {r.warnings.map((w) => <span key={w} className="rounded-sm border border-gold/40 bg-gold/5 px-1.5 py-0.5 font-mono text-[10px] text-gold">⚠ {w}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
