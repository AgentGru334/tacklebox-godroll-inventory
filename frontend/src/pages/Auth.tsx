import { SignIn, SignUp } from "@clerk/react";
import { Crosshair, ScanLine, ShieldCheck, Layers } from "lucide-react";

function BrandPanel() {
  return (
    <div className="hud-grid relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-steel bg-panel/60 p-12 lg:flex">
      <div className="absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-teal/10 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <div className="chamfer grid h-11 w-11 place-items-center bg-gold text-[#1C1100]">
          <Crosshair className="h-6 w-6" strokeWidth={2.5} />
        </div>
        <div>
          <div className="font-heading text-lg font-black uppercase text-white">Tacklebox</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-teal">Borderlands 4 God Roll Library</div>
        </div>
      </div>
      <div className="relative max-w-lg">
        <h1 className="font-heading text-5xl font-black uppercase leading-[0.95] tracking-tight text-white">
          Card <span className="text-teal">Injector</span>
        </h1>
        <p className="mt-4 text-zinc-300">
          Swap freshly regenerated level 70 NCS Lookup cards into the God Roll Library — matched by exact serial, reviewed before anything ships.
        </p>
        <ul className="mt-8 space-y-3 text-sm text-zinc-300">
          <li className="flex gap-3"><ScanLine className="h-5 w-5 shrink-0 text-teal" />Exact serial matching — display names never decide a match.</li>
          <li className="flex gap-3"><Layers className="h-5 w-5 shrink-0 text-gold" />Clean matches auto-replace; every exception is shown before export.</li>
          <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />Reviewable package by default. Direct upload needs a separate final confirmation.</li>
        </ul>
      </div>
      <div className="relative font-mono text-[10px] uppercase tracking-wider text-zinc-500">No automatic production deployment</div>
    </div>
  );
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <BrandPanel />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="text-center lg:hidden">
          <div className="font-heading text-3xl font-black uppercase text-white">Card <span className="text-teal">Injector</span></div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-gold">Tacklebox · BL4 God Roll Library</div>
        </div>
        <div data-testid="clerk-auth-card">{children}</div>
      </div>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthLayout>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp />
    </AuthLayout>
  );
}

export function SignUpPage() {
  return (
    <AuthLayout>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthLayout>
  );
}
