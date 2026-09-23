import { onAuthStateChanged, type User } from "firebase/auth";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CandidateProfile } from "@shared/types";
import { api, devUser, errMsg } from "./lib/api";
import { auth, signInWithGoogle } from "./lib/firebase";
import { track, trackPage } from "./lib/analytics";
import ConsentBanner from "./components/ConsentBanner";
import { Button, ErrorNote, Spinner, ToastProvider } from "./ui";
import Landing from "./pages/Landing";
// The signed-in app loads on demand, so first-time visitors only download the landing page.
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Shell = lazy(() => import("./pages/Shell"));

export interface AiState {
  available: boolean;
  poolConfigured: boolean;
  ownKey: { last4: string; status: "ok" | "invalid" | "quota"; lastError?: string; addedAt: string } | null;
}

export interface Me {
  user: { uid: string; email?: string; name?: string; isAdmin: boolean };
  profile: CandidateProfile;
  usage: { used: number; limit: number; remaining: number };
  ai: AiState;
  unreadNotifications: number;
}

export const Logo = ({ className = "h-9 w-9" }: { className?: string }) => <img src="/favicon.svg?v=3" alt="" className={className} />;
/** "MyCareer.AI" with the brand-coloured ".AI". */
export const Wordmark = ({ className = "text-lg" }: { className?: string }) => (
  <span className={`font-display font-bold tracking-tight text-ink ${className}`}>MyCareer<span className="text-peacock">.AI</span></span>
);

function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true); setError(null);
    try { await signInWithGoogle(); } catch (e) { setError(errMsg(e).includes("popup-closed") ? null : "Sign-in failed. Please try again."); } finally { setBusy(false); }
  };
  useEffect(() => trackPage("landing", "MyCareer.AI"), []);
  return <Landing onSignIn={() => void signIn()} busy={busy} error={error} />;
}

const RETURNING = "mc_signed_in_before";
const wasSignedIn = () => { try { return localStorage.getItem(RETURNING) === "1"; } catch { return false; } };

export default function App() {
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setFbUser(u); setAuthReady(true);
    try { if (u) localStorage.setItem(RETURNING, "1"); else localStorage.removeItem(RETURNING); } catch { /* storage blocked: fine */ }
  }), []);
  const signedIn = Boolean(devUser || fbUser);

  const refresh = useCallback(async () => {
    try { setMe(await api<Me>("/me")); setError(null); } catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => { if (signedIn) void refresh(); else setMe(null); }, [signedIn, refresh]);

  // Analytics: one sign_up/login per session, and the moment onboarding finishes.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!me) return;
    try {
      if (!sessionStorage.getItem("mc_session_tracked")) {
        sessionStorage.setItem("mc_session_tracked", "1");
        const isNew = Date.now() - new Date(me.profile.createdAt).getTime() < 10 * 60_000;
        track(isNew ? "sign_up" : "login", { method: devUser ? "dev" : "google" });
      }
    } catch { /* storage blocked */ }
    if (lastStatus.current && lastStatus.current !== "ready" && me.profile.status === "ready") track("onboarding_complete");
    lastStatus.current = me.profile.status;
  }, [me]);

  let body;
  // While Firebase checks the session, first-time visitors see the landing page at once; only people who were
  // signed in on this device get the brief loading state (so the landing page doesn't flash before their dashboard).
  if (!devUser && !authReady) body = wasSignedIn() ? <Spinner label="Loading…" className="min-h-full" /> : <Login />;
  else if (!signedIn) body = <Login />;
  else if (error && !me) body = <div className="mx-auto max-w-md space-y-4 p-8"><ErrorNote error={error} /><Button onClick={refresh}>Try again</Button></div>;
  else if (!me) body = <Spinner label="Loading your profile…" className="min-h-full" />;
  else body = ["empty", "parsing", "needs_info"].includes(me.profile.status) ? <Onboarding me={me} refresh={refresh} /> : <Shell me={me} refresh={refresh} />;
  return <ToastProvider><Suspense fallback={<Spinner label="Loading…" className="min-h-full" />}>{body}</Suspense><ConsentBanner /></ToastProvider>;
}
