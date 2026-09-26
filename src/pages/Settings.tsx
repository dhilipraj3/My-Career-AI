import { BarChart3, Download, Gauge, KeyRound, LogOut, PauseCircle, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AiState, Me } from "../App";
import { api, devUser, downloadFile, errMsg } from "../lib/api";
import { getConsent, setConsent } from "../lib/analytics";
import { signOutUser } from "../lib/firebase";
import { getLowData, setLowData } from "../lib/lowdata";
import { useNav } from "../lib/nav";
import AlertInbox from "../components/AlertInbox";
import PublicProfileCard from "../components/PublicProfileCard";
import { Badge, Button, Card, Modal, PageHeader, Progress, useToast } from "../ui";

function Row({ icon, title, detail, children }: { icon: ReactNode; title: string; detail: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{title}</p><div className="mt-0.5 text-sm text-slate-600">{detail}</div></div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}

export default function Settings({ me, ai }: { me: Me; ai: AiState }) {
  const nav = useNav();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [lowData, setLow] = useState(getLowData());
  const [analyticsOn, setAnalyticsOn] = useState(getConsent() === "granted");
  const u = me.usage;

  const togglePause = async () => {
    try { await api("/profile", { method: "PATCH", body: { discoveryPaused: !me.profile.discoveryPaused } }); await nav.refresh(); toast("success", me.profile.discoveryPaused ? "Job search resumed" : "Job search paused"); } catch (e) { toast("error", errMsg(e)); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Your AI assistant, job search and account." />

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-slate-500">AI assistant</h2>
        <Card className="divide-y divide-slate-100 p-0">
          <Row icon={<Sparkles className="h-5 w-5" />} title="How AI works here"
            detail={<>Everything works without AI. With AI you get natural chat, smarter resume reading and better tailoring. Everyone gets <strong>{u.limit} free AI credits a day</strong>; with your own free Google key there's no daily limit from us.</>} />
          <Row icon={<KeyRound className="h-5 w-5" />} title="Your own Google AI key"
            detail={ai.ownKey ? <span className="flex flex-wrap items-center gap-2">Connected (…{ai.ownKey.last4}) <Badge tone={ai.ownKey.status === "ok" ? "green" : "amber"}>{ai.ownKey.status === "ok" ? "Working" : ai.ownKey.status === "quota" ? "Out of free quota for now" : "Rejected — please replace"}</Badge></span> : "Not connected. Takes about a minute, and it's free."}>
            <Button variant={ai.ownKey ? "secondary" : "primary"} onClick={nav.openAiSetup}>{ai.ownKey ? "Manage" : "Add my key"}</Button>
          </Row>
          {!ai.ownKey && (
            <div className="space-y-2 p-5">
              <div className="flex justify-between text-sm"><span className="text-slate-600">Shared AI credits used today</span><span className="font-medium tabular-nums text-ink">{u.used} / {u.limit}</span></div>
              <Progress value={(u.used / Math.max(1, u.limit)) * 100} tone={u.remaining === 0 ? "amber" : "brand"} />
              {!ai.poolConfigured && <p className="text-xs text-amber-700">The app owner hasn't set up shared AI yet — add your own key to use AI features.</p>}
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-slate-500">Job search</h2>
        <Card className="p-0">
          <Row icon={<PauseCircle className="h-5 w-5" />} title="Automatic job search"
            detail={me.profile.discoveryPaused ? "Paused — I won't look for new jobs or send match alerts." : "On — I check every source about once an hour and alert you to strong new matches."}>
            <Button variant="secondary" onClick={togglePause}>{me.profile.discoveryPaused ? "Resume" : "Pause"}</Button>
          </Row>
        </Card>
        <Card className="p-0"><AlertInbox /></Card>
        <Card className="p-0"><PublicProfileCard /></Card>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-slate-500">Account & privacy</h2>
        <Card className="divide-y divide-slate-100 p-0">
          <Row icon={<ShieldCheck className="h-5 w-5" />} title="Your data" detail="Your resume and profile are private to you. I never submit applications or share your details without your confirmation." />
          <Row icon={<Gauge className="h-5 w-5" />} title="Low-data mode"
            detail={lowData ? "On — no animations and smaller lists, to save data and battery on slow connections." : "Off — turn on for slow or metered connections and older phones."}>
            <Button variant="secondary" onClick={() => { setLowData(!lowData); setLow(!lowData); toast("info", lowData ? "Low-data mode off" : "Low-data mode on"); }}>{lowData ? "Turn off" : "Turn on"}</Button>
          </Row>
          <Row icon={<Download className="h-5 w-5" />} title="Download your data"
            detail="Get everything I hold about you as one file: profile, resumes, applications, practice sessions and activity. Stored AI keys are never included.">
            <Button variant="secondary" onClick={() => void downloadFile("/me/export", "my-mycareer-ai-data.json").catch((e) => toast("error", errMsg(e)))}>Download</Button>
          </Row>
          <Row icon={<BarChart3 className="h-5 w-5" />} title="Usage analytics"
            detail={analyticsOn ? "On — anonymous usage counts (pages, searches, saves) help us improve. No name, email or resume details are sent." : "Off — nothing about how you use the app is sent to Google Analytics."}>
            <Button variant="secondary" onClick={() => { setConsent(!analyticsOn); setAnalyticsOn(!analyticsOn); toast("info", analyticsOn ? "Analytics turned off" : "Thanks — analytics turned on"); }}>{analyticsOn ? "Turn off" : "Turn on"}</Button>
          </Row>
          <Row icon={<LogOut className="h-5 w-5" />} title="Signed in" detail={me.user.email}>
            {!devUser && <Button variant="secondary" onClick={() => void signOutUser()}>Sign out</Button>}
          </Row>
          <Row icon={<Trash2 className="h-5 w-5 text-red-500" />} title="Delete account" detail="Permanently delete your profile, resumes, matches, applications and AI key.">
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete…</Button>
          </Row>
        </Card>
      </section>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account?"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={busy} disabled={typed !== "DELETE"} onClick={async () => {
          setBusy(true);
          try { await api("/account", { method: "DELETE" }); await signOutUser().catch(() => undefined); location.hash = ""; location.reload(); } catch (e) { toast("error", errMsg(e)); setBusy(false); }
        }}>Delete everything</Button></>}>
        <div className="space-y-3 text-sm text-slate-600">
          <p>This permanently deletes your profile, resumes, matches, applications, notifications and saved AI key. It can't be undone.</p>
          <label className="block">Type <strong>DELETE</strong> to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3" /></label>
        </div>
      </Modal>
    </div>
  );
}
