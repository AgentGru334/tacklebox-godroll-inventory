import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/ui/themes";
import { setTokenGetter } from "@/lib/api";
import { BACKEND_URL } from "@/lib/config";
import { queryClient } from "@/lib/queryClient";

const appearance = {
  theme: dark,
  variables: {
    colorPrimary: "#00E5FF",
    colorPrimaryForeground: "#04151F",
    colorBackground: "#14181F",
    colorForeground: "#F3F4F6",
    colorInput: "#1A202C",
    colorInputForeground: "#F3F4F6",
    colorBorder: "#27303E",
    fontFamily: "'Plus Jakarta Sans Variable', sans-serif",
    borderRadius: "0.25rem",
  },
  captcha: { theme: "dark" as const },
};

interface ClerkConfig {
  enabled: boolean;
  publishable_key: string;
  proxy_url: string;
}

// Registers Clerk's getToken with the fetch layer and wipes cached data when the account changes.
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken, userId } = useAuth();
  setTokenGetter(() => getToken());
  const prev = useRef(userId);
  useEffect(() => {
    if (prev.current !== userId) {
      queryClient.clear();
      prev.current = userId;
    }
  }, [userId]);
  return <>{children}</>;
}

export default function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ClerkConfig | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const cfg = (await (await fetch(`${BACKEND_URL}/api/clerk/config`)).json()) as ClerkConfig;
        if (cfg.enabled) {
          if (!cancelled) setConfig(cfg);
          return;
        }
      } catch (error) {
        // backend restarting: log it and retry below; after 20 tries the page shows "Sign-in is unavailable"
        console.warn(`Sign-in config not reachable yet (attempt ${attempt + 1}/21)`, error);
      }
      if (cancelled) return;
      if (attempt >= 20) {
        setUnavailable(true);
        return;
      }
      setTimeout(() => load(attempt + 1), 1500);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable)
    return (
      <p data-testid="auth-unavailable" style={{ padding: 24 }}>
        Sign-in is unavailable right now. Refresh the page to try again.
      </p>
    );
  if (!config) return null;
  return (
    <ClerkProvider
      publishableKey={config.publishable_key}
      proxyUrl={config.proxy_url || undefined}
      appearance={appearance}
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
    >
      <AuthBridge>{children}</AuthBridge>
    </ClerkProvider>
  );
}
