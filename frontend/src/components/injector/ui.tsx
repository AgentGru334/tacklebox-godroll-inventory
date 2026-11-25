import { cn } from "@/lib/utils"
import { cardImageUrl } from "@/lib/config";
import { REASON_LABELS } from "@/lib/types";
import type { Decision } from "@/lib/types";

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-teal">{kicker}</div>
        <h1 className="mt-1 font-heading text-3xl font-black uppercase tracking-tight text-white sm:text-4xl" data-testid="page-title">
          {title}
        </h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-sm border border-steel bg-panel/90 shadow-[0_8px_30px_rgba(0,0,0,0.35)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function SerialPill({ serial, className }: { serial: string; className?: string }) {
  return (
    <code
      className={cn("inline-block max-w-full truncate rounded-sm border border-teal/25 bg-gunmetal px-2 py-0.5 font-mono text-[11px] text-teal", className)}
      title={serial}
    >
      {serial || "— no serial —"}
    </code>
  );
}

export function ReasonBadges({ reasons }: { reasons: string[] }) {
  if (!reasons.length)
    return (
      <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
        Clean match
      </span>
    );
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span
          key={r}
          data-testid={`reason-${r}`}
          className="rounded-sm border border-hazard/40 bg-hazard/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-red-300"
        >
          {REASON_LABELS[r] ?? r}
        </span>
      ))}
    </div>
  );
}

const DECISION_STYLE: Record<Decision, { label: string; cls: string }> = {
  auto_approved: { label: "Auto-replace", cls: "border-teal/50 bg-teal/10 text-teal" },
  approved: { label: "Approved", cls: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" },
  rejected: { label: "Rejected", cls: "border-zinc-500/50 bg-zinc-500/10 text-zinc-300" },
  pending: { label: "Needs decision", cls: "border-gold/60 bg-gold/10 text-gold" },
};

export function DecisionBadge({ decision, testId }: { decision: Decision; testId?: string }) {
  const s = DECISION_STYLE[decision];
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider", s.cls)}>
      {decision === "pending" && <span className="h-1.5 w-1.5 animate-beacon rounded-full bg-gold" />}
      {s.label}
    </span>
  );
}

export function Stat({ label, value, tone = "white", testId }: { label: string; value: number | string; tone?: "white" | "teal" | "gold" | "red" | "green"; testId: string }) {
  const color = { white: "text-white", teal: "text-teal", gold: "text-gold", red: "text-red-400", green: "text-emerald-300" }[tone];
  return (
    <div className="rounded-sm border border-steel bg-plate/70 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">{label}</div>
      <div className={cn("mt-1 font-heading text-3xl font-black tabular-nums", color)} data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

export function CardImage({ imageId, alt, className }: { imageId: string | null; alt: string; className?: string }) {
  if (!imageId)
    return (
      <div className={cn("hud-grid grid aspect-[5/7] place-items-center rounded-sm border border-dashed border-hazard/50 bg-gunmetal text-center font-mono text-[10px] uppercase tracking-wider text-red-300", className)}>
        No image
      </div>
    );
  return (
    <img
      src={cardImageUrl(imageId)}
      alt={alt}
      loading="lazy"
      className={cn("aspect-[5/7] w-full rounded-sm border border-steel bg-gunmetal object-cover", className)}
    />
  );
}

// The "Card pending" placeholder published for image-missing validated items.
export function PendingCard({ name, serial, rarity, kind, published }: { name: string; serial: string; rarity: string; kind: string; published: boolean }) {
  return (
    <div className="relative aspect-[5/7] w-full overflow-hidden rounded-sm border border-gold/40 bg-gunmetal" data-testid="card-pending-placeholder">
      <div className="hazard-stripes absolute inset-x-0 top-0 h-2.5 opacity-80" />
      <div className="hud-grid absolute inset-0" />
      <div className="relative flex h-full flex-col justify-between p-3 pt-5">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold">{rarity || "Validated"} · {kind || "Item"}</div>
          <div className="mt-1 line-clamp-2 font-heading text-sm font-black uppercase leading-tight text-white">{name}</div>
        </div>
        <div className="text-center">
          <div className="mx-auto mb-2 h-8 w-8 rounded-full border-2 border-dashed border-gold/70" />
          <div className="font-heading text-base font-black uppercase tracking-wide text-gold">Card pending</div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">{published ? "Placeholder live" : "Not yet published"}</div>
        </div>
        <div className="truncate rounded-sm bg-black/50 px-1.5 py-1 font-mono text-[9px] text-teal" title={serial}>
          {serial}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, children, testId }: { title: string; body: string; children?: React.ReactNode; testId: string }) {
  return (
    <Panel className="hud-grid px-6 py-12 text-center" data-testid={testId}>
      <div className="font-heading text-xl font-black uppercase text-white">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">{body}</p>
      {children && <div className="mt-5 flex justify-center gap-2">{children}</div>}
    </Panel>
  );
}
