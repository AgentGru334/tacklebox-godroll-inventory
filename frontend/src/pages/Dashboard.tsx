import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Upload, ScanSearch, PackageCheck, ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Panel, Stat, DecisionBadge } from "@/components/injector/ui";
import { useMe, useStats } from "@/hooks/useInjector";
import { cn } from "@/lib/utils";

const STEPS = [
  { to: "/import", icon: Upload, title: "Import", body: "God Roll catalog JSON + validated card export ZIP." },
  { to: "/review", icon: ScanSearch, title: "Match review", body: "Exact serial matches. Approve or reject every exception." },
  { to: "/export", icon: PackageCheck, title: "Export", body: "Reviewable import package, or confirmed direct upload." },
  { to: "/admin/queue", icon: ShieldAlert, title: "Admin queue", body: "Publish Card pending placeholders for image-missing items.", admin: true },
];

export default function Dashboard() {
  const { data: stats, isError } = useStats();
  const { data: me } = useMe();
  const batch = stats?.latest_batch ?? null;
  const show = (n: number | undefined) => (isError || n === undefined ? "—" : n);

  return (
    <div>
      <PageHeader kicker="Operations" title="Injector status">
        <Link to="/import" data-testid="dashboard-start-import" className={cn(buttonVariants(), "relative overflow-hidden font-bold uppercase tracking-wide")}>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-glow-swipe bg-white/30" />
          Start import <ArrowRight className="h-4 w-4" />
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Catalog items" value={show(stats?.catalog_total)} testId="stat-catalog-total" />
        <Stat label="With card" value={show(stats?.catalog_with_card)} tone="teal" testId="stat-with-card" />
        <Stat label="Image missing" value={show(stats?.catalog_missing)} tone="red" testId="stat-missing" />
        <Stat label="Card pending live" value={show(stats?.catalog_pending_placeholder)} tone="gold" testId="stat-pending-placeholder" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="min-w-0 p-5" data-testid="latest-batch-panel">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-black uppercase text-white">Latest card batch</h2>
            {batch && (
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400" data-testid="latest-batch-status">
                {batch.status.replace("_", " ")}
              </span>
            )}
          </div>
          {batch ? (
            <>
              <div className="mt-1 truncate font-mono text-xs text-zinc-400" data-testid="latest-batch-filename">
                {batch.filename} · {new Date(batch.created_at).toLocaleString()}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Entries" value={batch.total} testId="batch-total" />
                <Stat label="Clean" value={batch.clean} tone="green" testId="batch-clean" />
                <Stat label="Exceptions" value={batch.exceptions} tone="red" testId="batch-exceptions" />
                <Stat label="Undecided" value={batch.pending} tone="gold" testId="batch-pending" />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {batch.pending > 0 ? <DecisionBadge decision="pending" /> : <DecisionBadge decision="approved" />}
                <Link to={batch.pending > 0 ? "/review" : "/export"} data-testid="latest-batch-continue" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {batch.pending > 0 ? "Resolve exceptions" : "Go to export"} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-400" data-testid="no-batch-message">
              No card export imported yet. Upload the card ZIP on Import, then add any image-less records from a catalog JSON.
            </p>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-lg font-black uppercase text-white">Ground rules</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-zinc-300">
            <li><span className="font-mono text-teal">01</span> Match by exact item serial — never by display name alone.</li>
            <li><span className="font-mono text-teal">02</span> Source of truth: validated serials + new NCS Lookup cards at <span className="text-gold">level 70</span>.</li>
            <li><span className="font-mono text-teal">03</span> Clean matches auto-replace. Exceptions must all be decided before export.</li>
            <li><span className="font-mono text-teal">04</span> Default output is a reviewable package. Direct upload is simulated and needs a typed final confirmation.</li>
          </ul>
        </Panel>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.filter((s) => !s.admin || me?.role === "admin").map((s, i) => (
          <motion.div key={s.to} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.25 }}>
            <Link
              to={s.to}
              data-testid={`pipeline-step-${s.title.toLowerCase().replace(/\s+/g, "-")}`}
              className="group block h-full rounded-sm border border-steel bg-plate/60 p-4 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-teal/40 hover:shadow-[0_8px_24px_rgba(0,229,255,0.12)]"
            >
              <div className="flex items-center justify-between">
                <s.icon className="h-5 w-5 text-teal" />
                <span className="font-mono text-[10px] text-zinc-500">STEP {String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="mt-3 font-heading font-black uppercase text-white">{s.title}</div>
              <p className="mt-1 text-xs text-zinc-400">{s.body}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
