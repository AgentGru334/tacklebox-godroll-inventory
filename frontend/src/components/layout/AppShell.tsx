import { NavLink, Outlet, Navigate } from "react-router-dom";
import { Show, UserButton } from "@clerk/react";
import { LayoutDashboard, Upload, ScanSearch, PackageCheck, ShieldAlert, Users, Crosshair, Images, Link2, ScrollText, ListChecks, History } from "lucide-react";
import { useLatestBatch, useMe } from "@/hooks/useInjector";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Ops", full: "Dashboard", icon: LayoutDashboard, id: "dashboard" },
  { to: "/import", label: "Import", full: "Import", icon: Upload, id: "import" },
  { to: "/review", label: "Review", full: "Import Preview", icon: ScanSearch, id: "review" },
  { to: "/export", label: "Export", full: "Export", icon: PackageCheck, id: "export" },
  { to: "/admin/queue", label: "Queue", full: "Admin Queue", icon: ShieldAlert, id: "admin-queue", admin: true },
];
// Secondary pages: sidebar on desktop, header icons on phones.
const EXTRA = [
  { to: "/gallery", full: "Card Gallery", icon: Images, id: "gallery" },
  { to: "/links", full: "Unlinked Queue", icon: Link2, id: "links" },
  { to: "/worklist", full: "LV70 Worklist", icon: ListChecks, id: "worklist" },
  { to: "/history", full: "Import History", icon: History, id: "history" },
  { to: "/admin/audit", full: "Audit Log", icon: ScrollText, id: "audit", admin: true },
  { to: "/admin/users", full: "Users", icon: Users, id: "users", admin: true },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5" data-testid="app-brand">
      <div className="chamfer grid h-9 w-9 place-items-center bg-gold text-[#1C1100]">
        <Crosshair className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <div className="leading-none">
        <div className="font-heading text-[15px] font-black uppercase tracking-tight text-white">Card Injector</div>
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-teal">Tacklebox · BL4</div>
      </div>
    </div>
  );
}

function Shell() {
  const { data: me } = useMe();
  const { batch } = useLatestBatch();
  const isAdmin = me?.role === "admin";
  const pending = batch && batch.status !== "published" ? batch.pending : 0;

  return (
    <div className="min-h-dvh pb-20 lg:pb-0 lg:pl-64 print:p-0">
      {/* desktop sidebar */}
      <aside className="print:hidden fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-steel bg-sidebar/95 lg:flex">
        <div className="border-b border-steel px-5 py-5">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" data-testid="sidebar-nav">
          {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={`nav-${n.id}`}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-semibold transition-colors duration-150",
                  isActive ? "bg-plate text-white" : "text-zinc-400 hover:bg-plate/60 hover:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gold transition-opacity", isActive ? "opacity-100" : "opacity-0")} />
                  <n.icon className={cn("h-4 w-4", isActive ? "text-teal" : "")} />
                  <span className="flex-1">{n.full}</span>
                  {n.id === "review" && pending > 0 && (
                    <span data-testid="nav-pending-count" className="rounded-sm bg-gold px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#1C1100]">
                      {pending}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
          <div className="px-3 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">Library</div>
          {EXTRA.filter((n) => !n.admin || isAdmin).map((n) => (
            <NavLink key={n.to} to={n.to} data-testid={`nav-${n.id}`}
              className={({ isActive }) => cn("flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-semibold transition-colors duration-150",
                isActive ? "bg-plate text-white" : "text-zinc-400 hover:bg-plate/60 hover:text-white")}>
              <n.icon className="h-4 w-4" />
              {n.full}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-steel p-4 font-mono text-[10px] uppercase leading-relaxed tracking-wider text-zinc-500">
          Match key: exact serial
          <br />
          Source: NCS Lookup · LV 70
          <br />
          <span className="text-gold">No auto production deploy</span>
        </div>
      </aside>

      {/* top HUD bar */}
      <header className="print:hidden sticky top-0 z-20 flex h-14 items-center justify-between border-b border-steel bg-gunmetal/85 px-4 backdrop-blur-xl sm:px-6">
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-400 lg:flex" data-testid="hud-status">
          <span className={cn("h-2 w-2 rounded-full", pending ? "animate-beacon bg-gold" : "bg-emerald-400")} />
          {batch ? (
            <span>
              Batch {batch.id.slice(0, 8)} · {batch.status.replace("_", " ")} · {pending} awaiting decision
            </span>
          ) : (
            <span>No card batch imported yet</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <span
              data-testid="user-role-badge"
              className={cn(
                "rounded-sm border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
                isAdmin ? "border-gold/50 text-gold" : "border-teal/40 text-teal",
              )}
            >
              {me.role}
            </span>
          )}
          {EXTRA.filter((n) => !n.admin || isAdmin).map((n) => (
            <NavLink key={n.to} to={n.to} data-testid={`mobile-nav-${n.id}`} aria-label={n.full} className="text-zinc-400 hover:text-white lg:hidden">
              <n.icon className="h-5 w-5" />
            </NavLink>
          ))}
          <div data-testid="user-menu">
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <Outlet />
      </main>

      {/* mobile bottom dock */}
      <nav
        data-testid="mobile-nav"
        className="print:hidden fixed inset-x-0 bottom-0 z-30 grid border-t border-steel bg-gunmetal/95 backdrop-blur-xl lg:hidden"
        style={{ gridTemplateColumns: `repeat(${NAV.filter((n) => !n.admin || isAdmin).length}, minmax(0, 1fr))` }}
      >
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            data-testid={`mobile-nav-${n.id}`}
            className={({ isActive }) =>
              cn(
                "relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                isActive ? "text-teal" : "text-zinc-500",
              )
            }
          >
            <n.icon className="h-5 w-5" />
            {n.label}
            {n.id === "review" && pending > 0 && (
              <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-gold" />
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function AppShell() {
  return (
    <>
      <Show when="signed-in">
        <Shell />
      </Show>
      <Show when="signed-out">
        <Navigate to="/sign-in" replace />
      </Show>
    </>
  );
}
