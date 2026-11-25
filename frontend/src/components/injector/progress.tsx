import { cn } from "@/lib/utils";
import { LEVEL_LABELS } from "@/lib/types";
import type { Batch, LevelStatus } from "@/lib/types";

export function ProgressBar({ value, max, label, testId, tone = "teal" }: { value: number; max: number; label: string; testId: string; tone?: "teal" | "gold" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div data-testid={testId}>
      <div className="mb-1 flex justify-between font-mono text-[11px] uppercase tracking-wider text-zinc-400">
        <span>{label}</span>
        <span data-testid={`${testId}-percent`}>{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-sm border border-steel bg-gunmetal">
        <div className={cn("relative h-full overflow-hidden transition-[width] duration-500 ease-out", tone === "teal" ? "bg-teal" : "bg-gold")} style={{ width: `${pct}%` }}>
          <span className="absolute inset-y-0 left-0 w-1/3 animate-glow-swipe bg-white/40" />
        </div>
      </div>
    </div>
  );
}

export function AnalysisProgress({ batch }: { batch: Batch }) {
  if (batch.analysis_status === "done") return null;
  return (
    <div className="rounded-sm border border-teal/30 bg-teal/5 p-4" data-testid="analysis-progress">
      <ProgressBar value={batch.analysis_done} max={batch.analysis_total} label={`OCR verification · ${batch.analysis_done} / ${batch.analysis_total} cards`} testId="analysis-progress-bar" />
      <p className="mt-2 text-xs text-zinc-400">
        Reading the level and name on every card. Runs on the server: you can close this page, and it carries on (and resumes after a restart). Package and apply unlock when it finishes.
      </p>
    </div>
  );
}

const LEVEL_TONE: Record<LevelStatus, string> = {
  pending: "border-zinc-600 text-zinc-400",
  confirmed_70: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  outdated: "border-hazard/60 bg-hazard/10 text-red-300",
  possible_misread: "border-gold/60 bg-gold/10 text-gold",
  unreadable: "border-zinc-500/60 bg-zinc-500/10 text-zinc-300",
};

export function LevelBadge({ status, testId }: { status: LevelStatus; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", LEVEL_TONE[status])}>
      {LEVEL_LABELS[status]}
    </span>
  );
}
