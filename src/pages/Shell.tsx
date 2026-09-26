import { BarChart3, Bell, Briefcase, Building2, FileText, Home, LogOut, MessageCircle, Mic, MoreHorizontal, Search, Settings as SettingsIcon, Shield, Sparkles, User, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import type { NotificationRecord } from "@shared/types";
import { Logo, Wordmark, type AiState, type Me } from "../App";
import AiKeyWizard from "../components/AiKeyWizard";
import CommandPalette, { type Command } from "../components/CommandPalette";
import WelcomeTour from "../components/WelcomeTour";
import { api, devUser } from "../lib/api";
import { trackPage } from "../lib/analytics";
import { useI18n, type StringKey } from "../lib/i18n";
import { signOutUser } from "../lib/firebase";
import { firstName } from "../lib/labels";
import { NavCtx, hrefFor, parseHash, type Nav, type Page } from "../lib/nav";
import { Kbd, cn, timeAgo } from "../ui";
import Admin from "./Admin";
import Applications from "./Applications";
import Assistant from "../components/Assistant";
import Dashboard from "./Dashboard";
import JobDetail from "./JobDetail";
import JobSearch from "./JobSearch";
import Matches from "./Matches";
import ProfilePage from "./ProfilePage";
import ImportJobModal from "../components/ImportJobModal";
import ThemeToggle from "../components/ThemeToggle";
import Employer from "./Employer";
import Insights from "./Insights";
import Interview from "./Interview";
import Resumes from "./Resumes";
import Settings from "./Settings";

type Item = { page: Page; label: string; icon: ComponentType<{ className?: string }>; mobile?: boolean };

const MAIN: Item[] = [
  { page: "home", label: "Home", icon: Home, mobile: true },
  { page: "matches", label: "For you", icon: Sparkles, mobile: true },
  { page: "search", label: "Search jobs", icon: Search, mobile: true },
  { page: "applications", label: "Applications", icon: Briefcase, mobile: true },
];
const ME: Item[] = [
  { page: "profile", label: "Profile", icon: User },
  { page: "insights", label: "Insights", icon: BarChart3 },
  { page: "interview", label: "Interview prep", icon: Mic },
  { page: "resume", label: "Resumes", icon: FileText },
  { page: "employer", label: "For employers", icon: Building2 },
  { page: "settings", label: "Settings", icon: SettingsIcon },
];

const TITLES: Record<Page, string> = { home: "Home", matches: "For you", search: "Search jobs", applications: "Applications", resume: "Resumes", interview: "Interview prep", insights: "Insights", employer: "For employers", profile: "Profile", settings: "Settings", admin: "Admin" };

function NavLink({ item, active, onClick }: { item: Item; active: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <a href={hrefFor(item.page)} onClick={(e) => { e.preventDefault(); onClick(); }} aria-current={active ? "page" : undefined}
      className={cn("group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
      <item.icon className={cn("h-[18px] w-[18px]", active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600")} />{t(`nav.${item.page}` as StringKey)}
    </a>
  );
}

export default function Shell({ me, refresh }: { me: Me; refresh: () => Promise<void> }) {
  const { t, lang, setLang } = useI18n();
  const [route, setRoute] = useState(parseHash);
  // /add-job?url=… is a bookmark target: open the "add a job" window with that link, then move to a normal address.
  const [addJob, setAddJob] = useState<string | null>(() => (location.pathname === "/add-job" ? new URLSearchParams(location.search).get("url") || "" : null));
  useEffect(() => { if (location.pathname === "/add-job") history.replaceState(null, "", "/#search"); }, []);
  useEffect(() => { const on = () => setRoute(parseHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const [chat, setChat] = useState<{ open: boolean; prompt?: string; key?: number }>({ open: false });
  const [chatExpanded, setChatExpanded] = useState(false);
  // On a wide screen the assistant is docked beside the page, so it can stay open while you move around.
  const docked = () => window.matchMedia("(min-width: 1024px)").matches;
  const [bellOpen, setBellOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [aiWizard, setAiWizard] = useState(false);
  const [ai, setAi] = useState<AiState>(me.ai);
  const [notes, setNotes] = useState<NotificationRecord[]>([]);
  const unread = notes.filter((n) => !n.read).length;
  useEffect(() => setAi(me.ai), [me.ai]);

  const loadNotes = useCallback(async () => {
    try { setNotes((await api<{ notifications: NotificationRecord[] }>("/notifications")).notifications); } catch { /* non-critical */ }
  }, []);
  useEffect(() => { void loadNotes(); const t = setInterval(loadNotes, 30_000); return () => clearInterval(t); }, [loadNotes]);

  const nav: Nav = useMemo(() => ({
    go: (page, params) => { const h = hrefFor(page, params); if (location.hash !== h) location.hash = h; setRoute(parseHash(h)); setDrawer(false); window.scrollTo({ top: 0 }); },
    openJob: (id) => { location.hash = `#job/${encodeURIComponent(id)}`; if (!docked()) setChat((c) => ({ ...c, open: false })); setChatExpanded(false); setBellOpen(false); window.scrollTo({ top: 0 }); },
    openChat: (prompt) => setChat({ open: true, prompt, key: prompt ? Date.now() : undefined }),
    openAiSetup: () => setAiWizard(true),
    refresh,
  }), [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = me.user.isAdmin ? [...ME, { page: "admin" as Page, label: "Admin", icon: Shield }] : ME;
  const commands: Command[] = [...MAIN, ...items].map((i): Command => ({ id: i.page, label: `Go to ${i.label}`, icon: i.icon, run: () => nav.go(i.page) }))
    .concat([
      { id: "chat", label: "Ask the AI assistant", icon: MessageCircle, run: () => nav.openChat() },
      { id: "ai", label: ai.ownKey ? "Manage my AI key" : "Unlock unlimited AI (free Google key)", icon: Sparkles, run: () => setAiWizard(true) },
    ]);

  const page = route.page;
  const current = route.jobId ? t("nav.jobDetails") : t(`nav.${page}` as StringKey) || TITLES[page];
  useEffect(() => trackPage(route.jobId ? "job" : page, current), [page, route.jobId, current]);
  const initials = (me.profile.fullName || me.user.email || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <a href="#" onClick={(e) => { e.preventDefault(); nav.go("home"); }} className="flex items-center gap-2.5 px-2"><Logo className="h-8 w-8" /><Wordmark /></a>
      <nav className="space-y-1" aria-label="Main">{MAIN.map((i) => <NavLink key={i.page} item={i} active={!route.jobId && page === i.page} onClick={() => nav.go(i.page)} />)}</nav>
      <div>
        <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t("nav.you")}</p>
        <nav className="space-y-1" aria-label="Account">{items.map((i) => <NavLink key={i.page} item={i} active={!route.jobId && page === i.page} onClick={() => nav.go(i.page)} />)}</nav>
      </div>
      <div className="mt-auto space-y-3">
        {!ai.ownKey && (
          <button onClick={() => setAiWizard(true)} className="relative w-full overflow-hidden rounded-2xl bg-peacock p-4 text-left text-white shadow-lg shadow-brand-600/25">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4" />{t("chrome.unlockAi")}</p>
            <p className="mt-1 text-xs text-brand-100">{t("chrome.unlockAiHint")}</p>
          </button>
        )}
        <div className="flex items-center gap-3 rounded-2xl px-2 py-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{initials}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{me.profile.fullName || "You"}</p><p className="truncate text-xs text-slate-500">{me.user.email}</p></div>
          {!devUser && <button aria-label="Sign out" title="Sign out" onClick={() => void signOutUser()} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="h-4 w-4" /></button>}
        </div>
      </div>
    </div>
  );

  return (
    <NavCtx.Provider value={nav}>
      <div className={cn("min-h-full transition-[padding] duration-200 lg:pl-64", chat.open && "lg:pr-[420px]")}>
        <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }} className="skip-link">Skip to content</a>
        <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 border-r lg:block">{sidebar}</aside>
        {drawer && (
          <div className="scrim fixed inset-0 z-50 animate-fade-in lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
            <div className="glass-strong h-full w-72 animate-slide-in-right [animation-direction:reverse]">{sidebar}</div>
          </div>
        )}

        <header className="glass sticky top-0 z-20 border-b">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <p className="font-display text-base font-semibold text-ink lg:hidden">{current}</p>
            <button onClick={() => setPaletteOpen(true)} className="ml-auto hidden h-10 w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 transition hover:border-slate-300 hover:bg-white sm:flex lg:ml-0">
              <Search className="h-4 w-4" /><span className="flex-1 text-left">{t("chrome.search")}</span><Kbd>Ctrl K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <div className="mr-1 flex rounded-lg bg-slate-100/80 p-0.5 text-xs font-semibold" role="group" aria-label="Language / भाषा">
                {(["en", "hi"] as const).map((l) => <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-2 py-1", lang === l ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>{l === "en" ? "EN" : "हिं"}</button>)}
              </div>
              <button aria-label="Search" onClick={() => setPaletteOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:hidden"><Search className="h-5 w-5" /></button>
              <div className="relative">
                <ThemeToggle />
                <button aria-label="Notifications" onClick={() => { setBellOpen(!bellOpen); if (!bellOpen && unread) void api("/notifications/read", { body: {} }).then(loadNotes); }} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100">
                  <Bell className="h-5 w-5" />
                  {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{unread}</span>}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-96 max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-pop)] animate-slide-up">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><p className="font-semibold text-ink">Notifications</p><button aria-label="Close" onClick={() => setBellOpen(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
                    <div className="max-h-[60vh] overflow-auto">
                      {notes.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nothing yet. I'll let you know when I find good matches.</p>}
                      {notes.map((n) => (
                        <button key={n.id} onClick={() => (n.jobId ? nav.openJob(n.jobId) : setBellOpen(false))} className={cn("block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50", !n.read && "bg-brand-50/40")}>
                          <p className="text-sm font-medium text-ink">{n.title}</p><p className="text-sm text-slate-600">{n.body}</p><p className="mt-0.5 text-xs text-slate-400">{timeAgo(n.createdAt)}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => nav.openChat()} className="ml-1 hidden h-10 items-center gap-2 rounded-xl bg-peacock px-3.5 text-sm font-medium text-white shadow-md shadow-brand-600/25 transition hover:brightness-110 sm:flex">
                <MessageCircle className="h-4 w-4" />{t("chrome.assistant")}
              </button>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
          <div key={route.jobId || page} className="animate-slide-up">
            {route.jobId ? <JobDetail jobId={route.jobId} me={me} onBack={() => (history.length > 1 ? history.back() : nav.go("matches"))} onChanged={loadNotes} openChat={() => nav.openChat()} />
              : page === "home" ? <Dashboard me={me} ai={ai} />
              : page === "matches" ? <Matches me={me} />
              : page === "search" ? <JobSearch me={me} openJob={nav.openJob} initialQuery={route.params.get("q") || ""} />
              : page === "applications" ? <Applications openJob={nav.openJob} />
              : page === "interview" ? <Interview />
              : page === "insights" ? <Insights />
              : page === "employer" ? <Employer me={me} />
              : page === "resume" ? <Resumes me={me} refresh={refresh} />
              : page === "profile" ? <ProfilePage me={me} refresh={refresh} />
              : page === "settings" ? <Settings me={me} ai={ai} />
              : me.user.isAdmin ? <Admin /> : <Dashboard me={me} ai={ai} />}
          </div>
        </main>

        {addJob !== null && <ImportJobModal initialUrl={addJob} onClose={() => setAddJob(null)} onDone={(id) => { setAddJob(null); nav.openJob(id); }} />}

        <nav className="glass-strong fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main mobile">
          {[...MAIN, ...ME].filter((i) => i.mobile).map((i) => (
            <button key={i.page} onClick={() => nav.go(i.page)} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", !route.jobId && page === i.page ? "text-brand-600" : "text-slate-500")}>
              <i.icon className="h-5 w-5" />{i.page === "search" && lang === "en" ? "Search" : t(`nav.${i.page}` as StringKey)}
            </button>
          ))}
          <button onClick={() => setDrawer(true)} aria-label={t("nav.more")} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", drawer ? "text-brand-600" : "text-slate-500")}>
            <MoreHorizontal className="h-5 w-5" />{t("nav.more")}
          </button>
        </nav>

        <button onClick={() => nav.openChat()} aria-label="Ask the assistant" className={cn(chat.open && "hidden", "bg-peacock fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg shadow-brand-600/30 transition hover:brightness-110 sm:hidden")}>
          <MessageCircle className="h-6 w-6" />
        </button>

        {chat.open && (
          <Assistant key={chat.key} onClose={() => { setChat({ open: false }); setChatExpanded(false); }} initialPrompt={chat.prompt} ai={ai}
            context={{ page: route.jobId ? "job" : page, jobId: route.jobId || undefined }} expanded={chatExpanded} setExpanded={setChatExpanded}
            openJob={nav.openJob} onActed={() => { void refresh(); void loadNotes(); }}
            onNavigate={(p: Page) => { if (!docked()) setChat({ open: false }); setChatExpanded(false); nav.go(p); }}
            onAiSetup={() => setAiWizard(true)} name={firstName(me.profile.fullName)} />
        )}
        <WelcomeTour name={firstName(me.profile.fullName)} onAiSetup={() => setAiWizard(true)} />
        <AiKeyWizard open={aiWizard} onClose={() => setAiWizard(false)} ai={ai} onChanged={(a) => { setAi(a); void refresh(); }} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} onSearch={(q) => nav.go("search", { q })} />
      </div>
    </NavCtx.Provider>
  );
}

