import {
  ArrowRight, BadgeCheck, Bell, Briefcase, Building2, ChevronDown, FileCheck2, GraduationCap, HardHat, Lightbulb, Lock, MapPin, MessageCircle,
  Radar, Search, ShieldCheck, Sparkles, Target, Upload, UserRoundCheck, Wrench,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Logo, Wordmark } from "../App";
import HeroBrain, { type HeroJob } from "../components/HeroBrain";
import { errMsg } from "../lib/api";
import { POPULAR_CITIES } from "../lib/labels";
import { CountUp, useReveal } from "../lib/motion";
import { Badge, Button, CompanyMark, ErrorNote, cn, timeAgo } from "../ui";

interface Stats { liveJobs: number; companies: number; cities: number; sources: number; freshersJobs: number; remoteJobs: number; updatedAt?: string; topCities: Array<{ city: string; jobs: number }> }
interface PublicJob extends HeroJob { postedAt?: string; freshersWelcome?: boolean; workMode: string }

const pub = async <T,>(path: string): Promise<T> => {
  const r = await fetch(`/api/public${path}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong");
  return d as T;
};

const GoogleIcon = () => <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;

function SignInButton({ onSignIn, busy, size = "lg", label = "Get started with Google", className }: { onSignIn: () => void; busy: boolean; size?: "md" | "lg"; label?: string; className?: string }) {
  return <Button size={size} loading={busy} onClick={onSignIn} className={cn("shadow-lg shadow-brand-600/25", className)}>{!busy && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><GoogleIcon /></span>}{label}</Button>;
}

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{children}</p>;

// ---------------------------------------------------------------- Try it now
function TryIt({ onSignIn, busy }: { onSignIn: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [res, setRes] = useState<{ total: number; jobs: PublicJob[]; q: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (query = q, c = city) => {
    if (query.trim().length < 2) return;
    setLoading(true); setError(null);
    try { setRes({ ...(await pub<{ total: number; jobs: PublicJob[] }>(`/search?${new URLSearchParams({ q: query.trim(), ...(c ? { city: c } : {}) })}`)), q: query.trim() }); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  const examples: Array<[string, string]> = [["Data analyst", "Bengaluru"], ["Project manager", "Chennai"], ["Sales", "Mumbai"], ["Software engineer", ""]];
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-lift)] sm:p-7">
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try a role — e.g. accountant, delivery, React developer" aria-label="Role"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/70 pl-12 pr-3 text-base focus:border-brand-400 focus:bg-white focus:outline-none" /></div>
        <div className="relative sm:w-48"><MapPin className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
          <input value={city} onChange={(e) => setCity(e.target.value)} list="landing-cities" placeholder="Any city" aria-label="City"
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/70 pl-12 pr-3 text-base focus:border-brand-400 focus:bg-white focus:outline-none" /></div>
        <datalist id="landing-cities">{POPULAR_CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        <Button type="submit" size="lg" loading={loading} disabled={q.trim().length < 2}>Search live jobs</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Try:</span>
        {examples.map(([r, c]) => <button key={r} onClick={() => { setQ(r); setCity(c); void run(r, c); }} className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">{r}{c ? ` · ${c}` : ""}</button>)}
      </div>
      <div className="mt-4"><ErrorNote error={error} /></div>
      {res && (
        <div className="mt-4 space-y-3 animate-fade-in">
          <p className="text-sm text-slate-600"><strong className="text-ink">{res.total >= 1000 ? "1,000+" : res.total.toLocaleString("en-IN")}</strong> live jobs for “{res.q}”{city ? ` in ${city}` : ""}. Here are a few:</p>
          {res.jobs.length === 0 ? <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">No live jobs for that yet — sign in and I'll alert you the moment one appears, or bring in jobs you find elsewhere.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {res.jobs.map((j, i) => (
                <li key={i} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
                  <CompanyMark name={j.company} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{j.title}</p>
                    <p className="truncate text-xs text-slate-500">{j.company} · {j.location}{j.pay ? ` · ${j.pay}` : ""}</p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed border-slate-200 text-slate-400" title="Sign in to see your match"><Lock className="h-4 w-4" /></span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col items-start gap-3 rounded-2xl bg-brand-50 p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-brand-900"><strong>Want to know which of these fit you — and why?</strong> Sign in, upload your resume, and every job gets an honest match score.</p>
            <SignInButton onSignIn={onSignIn} busy={busy} size="md" label="See my matches" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Content
const STEPS: Array<{ icon: ComponentType<{ className?: string }>; title: string; text: string }> = [
  { icon: Upload, title: "Share your resume", text: "PDF, Word, or just paste it. No resume? Answer a few questions instead." },
  { icon: Sparkles, title: "AI understands you", text: "Your skills, experience, goals, city and pay — it asks only what it can't work out." },
  { icon: Target, title: "Get matched, honestly", text: "Every job scored and explained: what fits, what's missing, how sure it is." },
  { icon: FileCheck2, title: "Apply and get hired", text: "A tailored resume from your real experience. Track every application until you're placed." },
];

const FEATURES: Array<{ icon: ComponentType<{ className?: string }>; title: string; text: string; tone: string }> = [
  { icon: Radar, title: "Jobs from across India, live", text: "Thousands of openings from company careers sites and job boards, refreshed every hour. Duplicates merged, closed jobs removed.", tone: "from-brand-500 to-brand-700" },
  { icon: Target, title: "Match scores that explain themselves", text: "Excellent, good or fair — with the exact skills that match, the gaps, and what the score assumed.", tone: "from-emerald-500 to-emerald-700" },
  { icon: Lightbulb, title: "A coach, not just a list", text: "No great matches? It tells you why — the roles, cities or skills holding you back — and fixes it in one tap.", tone: "from-amber-500 to-orange-600" },
  { icon: FileCheck2, title: "Truthful tailored resumes", text: "Rewritten for each job using only what's really on your resume. It never invents a skill, number or employer.", tone: "from-sky-500 to-sky-700" },
  { icon: MessageCircle, title: "An assistant that does things", text: "“Find remote jobs above 10 LPA”, “Open my saved jobs”, “Prepare this application” — it asks before anything important.", tone: "from-accent-500 to-accent-700" },
  { icon: ShieldCheck, title: "Scam protection built in", text: "Registration fees, WhatsApp-only hiring, pay-per-week bait — flagged and hidden before you ever see them.", tone: "from-rose-500 to-rose-700" },
];

const PEOPLE: Array<{ icon: ComponentType<{ className?: string }>; who: string; text: string; tags: string[] }> = [
  { icon: GraduationCap, who: "Freshers & students", text: "No experience? Filter to “Freshers welcome”, build a resume by just answering questions, and find entry roles near you.", tags: ["Freshers welcome", "Internships", "Entry level"] },
  { icon: Briefcase, who: "Working professionals", text: "Tech, finance, sales, operations — see which roles fit your next step, what pays more, and apply with a tailored resume.", tags: ["Excellent matches", "Salary filters", "Remote & hybrid"] },
  { icon: HardHat, who: "Frontline & skilled workers", text: "Delivery, retail, drivers, electricians, BPO — pay shown per month, 10th/12th/ITI filters, and scam checks.", tags: ["₹/month pay", "10th · 12th · ITI", "Near you"] },
];

const FAQ: Array<[string, string]> = [
  ["Is it free?", "Yes. MyCareer.AI is free to use. Everyone gets a daily AI allowance, and you can add your own free Google AI key for unlimited AI help."],
  ["Where do the jobs come from?", "Directly from company careers sites (Workday, Greenhouse, Lever and more) and licensed job boards. We never scrape sites that don't allow it — jobs you find on Naukri or LinkedIn you can add with one paste."],
  ["Do you apply to jobs for me?", "No — and that's deliberate. I prepare everything and open the employer's page; you stay in control and submit yourself."],
  ["Will my resume be shared?", "No. Your resume and profile are private to you. Nothing is shared with an employer unless you apply."],
  ["Does it work without a resume?", "Yes. You can paste text or simply answer a few questions, and I'll build your profile from that."],
];

// ---------------------------------------------------------------- Page
export default function Landing({ onSignIn, busy, error }: { onSignIn: () => void; busy: boolean; error: string | null }) {
  const ref = useReveal<HTMLDivElement>();
  const [stats, setStats] = useState<Stats | null>(null);
  const [heroJobs, setHeroJobs] = useState<HeroJob[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    void pub<Stats>("/stats").then(setStats).catch(() => undefined);
    // A handful of real, current jobs for the hero animation.
    void Promise.all(["manager", "engineer", "analyst", "executive"].map((q) => pub<{ jobs: PublicJob[] }>(`/search?q=${q}`).catch(() => ({ jobs: [] as PublicJob[] }))))
      .then((rs) => setHeroJobs(rs.flatMap((r) => r.jobs.slice(0, 3)).filter((j, i, a) => a.findIndex((x) => x.company === j.company) === i).slice(0, 9)));
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div ref={ref} className="min-h-full bg-white">
      {/* Nav */}
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <a href="#" className="flex items-center gap-2.5"><Logo className="h-8 w-8" /><Wordmark /></a>
          <nav className="hidden flex-1 items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {[["how", "How it works"], ["try", "Try it"], ["features", "Features"], ["everyone", "Who it's for"], ["faq", "FAQ"]].map(([id, l]) => <button key={id} onClick={() => scrollTo(id)} className="hover:text-ink">{l}</button>)}
          </nav>
          <div className="ml-auto flex items-center gap-2"><Button variant="ghost" onClick={onSignIn} className="hidden sm:inline-flex">Sign in</Button><Button onClick={onSignIn} loading={busy}>Get started</Button></div>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-gradient relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
          <div className="animate-slide-up">
            {stats && (
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                Live · {stats.liveJobs.toLocaleString("en-IN")} jobs{stats.updatedAt ? ` · updated ${timeAgo(stats.updatedAt)}` : ""}
              </p>
            )}
            <h1 className="mt-5 text-[2.5rem] font-extrabold leading-[1.08] sm:text-5xl xl:text-[3.5rem]">Your personal job agent,<br /><span className="text-shimmer">working until you're hired.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">Upload your resume once. MyCareer.AI understands you, searches every source for the right jobs, explains each match honestly, prepares truthful applications — and stays with you until you're placed.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <SignInButton onSignIn={onSignIn} busy={busy} />
              <Button size="lg" variant="secondary" onClick={() => scrollTo("try")}><Search className="h-5 w-5" />Try it without signing up</Button>
            </div>
            <div className="mt-3 max-w-md"><ErrorNote error={error} /></div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              {["Free to use", "Never applies without you", "No fake or scam jobs"].map((t) => <li key={t} className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-emerald-600" />{t}</li>)}
            </ul>
          </div>
          <div className="animate-slide-up [animation-delay:120ms]"><HeroBrain jobs={heroJobs} liveJobs={stats?.liveJobs || 0} /></div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-10 sm:grid-cols-4">
          {[
            { v: stats?.liveJobs, l: "live jobs right now", icon: Briefcase },
            { v: stats?.companies, l: "hiring companies", icon: Building2 },
            { v: stats?.cities, l: "cities across India", icon: MapPin },
            { v: stats?.sources, l: "job sources, checked hourly", icon: Radar },
          ].map((s) => (
            <div key={s.l} className="reveal text-center">
              <s.icon className="mx-auto h-5 w-5 text-brand-500" />
              <p className="mt-2 font-display text-3xl font-extrabold text-ink sm:text-4xl">{s.v !== undefined ? <CountUp value={s.v} /> : "—"}</p>
              <p className="mt-1 text-sm text-slate-500">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <div className="reveal mx-auto max-w-2xl text-center"><Eyebrow>How it works</Eyebrow><h2 className="mt-2 text-3xl font-bold sm:text-4xl">From resume to offer, with an AI by your side</h2></div>
        <ol className="relative mt-14 grid gap-8 md:grid-cols-4">
          <div className="absolute left-[12%] right-[12%] top-7 hidden h-0.5 bg-gradient-to-r from-brand-200 via-brand-400 to-emerald-300 md:block" />
          {STEPS.map((s, i) => (
            <li key={s.title} className="reveal relative text-center" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-[var(--shadow-lift)] ring-1 ring-brand-100"><s.icon className="h-6 w-6" /></span>
              <p className="mt-2 text-xs font-bold text-brand-500">STEP {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Try it */}
      <section id="try" className="scroll-mt-20 bg-gradient-to-b from-brand-50/60 to-white py-20">
        <div className="mx-auto max-w-4xl px-5">
          <div className="reveal mb-8 text-center"><Eyebrow>Try it now — no sign-up</Eyebrow><h2 className="mt-2 text-3xl font-bold sm:text-4xl">Search real, live jobs</h2><p className="mx-auto mt-3 max-w-xl text-slate-600">These are the actual openings in MyCareer.AI right now. Sign in to see how well each one fits you.</p></div>
          <div className="reveal"><TryIt onSignIn={onSignIn} busy={busy} /></div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <div className="reveal mx-auto max-w-2xl text-center"><Eyebrow>What it does for you</Eyebrow><h2 className="mt-2 text-3xl font-bold sm:text-4xl">Everything a great recruiter would do — for you</h2></div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="reveal group rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[var(--shadow-card)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition group-hover:scale-110", f.tone)}><f.icon className="h-6 w-6" /></span>
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Product glimpse: an honest match */}
      <section className="bg-ink py-20 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-2">
          <div className="reveal">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">Honest by design</p>
            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Every match tells you the whole story</h2>
            <p className="mt-4 text-slate-300">Most job apps just say “recommended”. MyCareer.AI shows exactly why a job fits, what you're missing, and what it couldn't tell from the posting — so you spend time only on jobs worth it.</p>
            <ul className="mt-6 space-y-3 text-slate-200">
              {["Skills matched against your real resume", "Location, pay and experience checked against what you asked for", "Gaps shown up front — with how to close them", "Scam and closed listings filtered out"].map((t) => <li key={t} className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />{t}</li>)}
            </ul>
          </div>
          <div className="reveal rounded-3xl bg-white p-6 text-slate-800 shadow-2xl">
            <div className="flex items-start gap-4">
              <CompanyMark name="Example Tech" size={52} />
              <div className="flex-1"><p className="font-display text-lg font-bold text-ink">Senior Project Manager</p><p className="text-sm text-slate-500">Example Tech · Chennai · Hybrid</p></div>
              <div className="flex flex-col items-center"><div className="flex h-16 w-16 items-center justify-center rounded-full border-[5px] border-emerald-500 font-display text-xl font-bold text-emerald-600">86</div><span className="mt-1 text-xs font-semibold text-emerald-700">Excellent</span></div>
            </div>
            <div className="mt-5 space-y-2.5">
              {[["Skills", 92], ["Experience", 100], ["Role fit", 85], ["Location", 100]].map(([l, v]) => (
                <div key={l as string}><div className="mb-1 flex justify-between text-xs"><span className="text-slate-600">{l}</span><span className="font-medium">{v}%</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${v}%` }} /></div></div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="font-semibold text-emerald-700">✓ What matches</p><p className="mt-1 text-slate-600">9 of 10 required skills · 12 yrs vs 8+ asked · your city</p></div>
              <div><p className="font-semibold text-amber-700">! Gaps</p><p className="mt-1 text-slate-600">Delivery Management not on your resume</p></div>
            </div>
            <p className="mt-4 text-center text-xs text-slate-400">Example for illustration</p>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="everyone" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
        <div className="reveal mx-auto max-w-2xl text-center"><Eyebrow>Built for everyone</Eyebrow><h2 className="mt-2 text-3xl font-bold sm:text-4xl">Whoever you are, there's a right job for you</h2></div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PEOPLE.map((p, i) => (
            <div key={p.who} className="reveal rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-6" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><p.icon className="h-6 w-6" /></span>
              <h3 className="mt-4 text-lg font-semibold">{p.who}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.text}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">{p.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}</div>
            </div>
          ))}
        </div>
        {stats && stats.topCities.length > 0 && (
          <div className="reveal mt-12 rounded-3xl border border-slate-200/80 p-6">
            <p className="text-center text-sm font-semibold text-slate-500">Live jobs by city right now</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">{stats.topCities.map((c) => <a key={c.city} href={`/jobs-in-${c.city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-brand-50 hover:text-brand-700"><strong className="text-ink">{c.city}</strong> · {c.jobs.toLocaleString("en-IN")}</a>)}</div>
          </div>
        )}
      </section>

      {/* Trust */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: UserRoundCheck, t: "You stay in control", d: "Nothing is ever submitted for you. Important actions always ask first." },
            { icon: FileCheck2, t: "Never makes things up", d: "Tailored resumes use only your real experience — checked automatically." },
            { icon: ShieldCheck, t: "Private by default", d: "Your resume and profile are yours. Delete everything any time." },
            { icon: Bell, t: "Always on your side", d: "Hourly job checks, follow-up reminders, and alerts for strong matches." },
          ].map((x) => (
            <div key={x.t} className="reveal flex gap-3"><x.icon className="h-6 w-6 shrink-0 text-brand-600" /><div><p className="font-semibold text-ink">{x.t}</p><p className="mt-1 text-sm text-slate-600">{x.d}</p></div></div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20">
        <div className="reveal text-center"><Eyebrow>Questions</Eyebrow><h2 className="mt-2 text-3xl font-bold sm:text-4xl">Good to know</h2></div>
        <div className="mt-10 divide-y divide-slate-100 rounded-3xl border border-slate-200/80">
          {FAQ.map(([q, a], i) => (
            <div key={q} className="reveal">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-semibold text-ink">
                {q}<ChevronDown className={cn("h-5 w-5 shrink-0 text-slate-400 transition", openFaq === i && "rotate-180")} />
              </button>
              {openFaq === i && <p className="-mt-1 px-6 pb-5 text-slate-600 animate-fade-in">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 pb-20">
        <div className="reveal relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-14 text-center text-white shadow-2xl sm:px-12">
          <div className="grid-bg absolute inset-0 opacity-40" />
          <div className="relative">
            <Wrench className="mx-auto h-8 w-8 text-brand-200" />
            <h2 className="mt-4 text-3xl font-extrabold text-white sm:text-4xl">Your right job is out there. Let's find it.</h2>
            <p className="mx-auto mt-3 max-w-xl text-brand-100">It takes two minutes to start. Free, private, and on your side until you're hired.</p>
            <div className="mt-8 flex justify-center"><Button size="lg" variant="secondary" loading={busy} onClick={onSignIn} className="ring-0"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><GoogleIcon /></span>Get started with Google<ArrowRight className="h-5 w-5" /></Button></div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100">
        <nav aria-label="Browse jobs" className="mx-auto grid max-w-6xl gap-6 px-5 pt-10 text-sm sm:grid-cols-3">
          {[
            ["Browse jobs", [["All jobs in India", "/jobs"], ["Fresher jobs", "/fresher-jobs"], ["Remote jobs", "/remote-jobs"], ["Part-time jobs", "/part-time-jobs"], ["Internships", "/internship-jobs"]]],
            ["Popular roles", [["Software Engineer", "/software-engineer-jobs"], ["Data Analyst", "/data-analyst-jobs"], ["Sales Executive", "/sales-executive-jobs"], ["Customer Support", "/customer-support-jobs"], ["Project Manager", "/project-manager-jobs"], ["Accountant", "/accountant-jobs"], ["Delivery", "/delivery-jobs"]]],
            ["Top cities", (stats?.topCities.length ? stats.topCities.map((c) => c.city) : ["Bengaluru", "Hyderabad", "Mumbai", "Pune", "Chennai", "Delhi"]).slice(0, 7).map((c) => [`Jobs in ${c}`, `/jobs-in-${c.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`])],
          ].map(([title, links]) => (
            <div key={title as string}>
              <p className="font-semibold text-ink">{title as string}</p>
              <ul className="mt-2 space-y-1.5">{(links as string[][]).map(([t, href]) => <li key={href}><a href={href} className="text-slate-600 hover:text-brand-700">{t}</a></li>)}</ul>
            </div>
          ))}
        </nav>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-slate-500 sm:flex-row">
          <span className="flex items-center gap-2"><Logo className="h-6 w-6" />MyCareer.AI · Made in India for job seekers everywhere</span>
          <span>Jobs from company careers sites and licensed job boards · We never apply without you</span>
        </div>
      </footer>
    </div>
  );
}
