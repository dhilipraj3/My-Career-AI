# MyCareer.AI — Product Roadmap & Build Checklist

> **Mission:** every person has a right job in the market. MyCareer.AI is the bridge. It understands the person, finds that job, and stays with them as an assistant until they are placed.

**Principles (these apply to every phase)**
- **100% free to run at launch:** free-tier AI and free APIs, with no paid services required.
- **Truthful:** the AI never invents a skill, employer, number or claim. Every fact records where it came from (resume, user, or AI inference).
- **Legitimate sourcing:** no server-side scraping of portals whose terms forbid it. Users bring those jobs in themselves (paste a link/description, forward alert emails).
- **The user stays in control:** nothing is submitted for the user, and sensitive actions need their confirmation.
- **Graceful degradation:** if every AI provider is down or out of quota, the app still works on rules alone.
- **For anybody:** freshers, professionals and blue-collar workers; English + Hindi at launch; voice-first option; works on low-end phones and slow networks.
- **A normal web app:** runs in the browser on desktop and mobile. No browser extension, no installable app/offline mode, no native apps.
- **Light theme only:** one clean, bright visual design (no dark mode).

**Decisions taken**
| Topic | Decision |
|---|---|
| Base code | `AI/` (secure, tested). `AI-Assistant-main/` is used for ideas and UI concepts only |
| AI | Gemini free tier on the server key → free fallbacks (Groq, OpenRouter free models, Cerebras) → Chrome built-in Gemini Nano on the user's device → rules |
| Search | Orama (in-process full-text + filters + meaning-based search) behind a `SearchIndex` interface, so we can switch to Typesense later |
| Storage/Auth | Firebase (project `my-career-ai`): Google sign-in, Firestore; local JSON store for dev |
| Email alerts | Personal forwarding address via Cloudflare Email Routing (free). Not the Gmail API, which needs a paid Google security audit |
| Employer posting | Yes, Phase 4 |
| Languages | English + Hindi at launch, translation framework ready for Tamil, Telugu, Kannada, Marathi, Bengali, Malayalam, Gujarati (Phase 5) |
| Hosting | Cloud Run + Firebase free tiers |
| Platform | Normal responsive web app only. No extension, no PWA/offline, no native apps |
| Theme | Light mode only |

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Job Sourcing Engine (the core)

### 0.1 Foundation
- [x] Create `MyCareerAI/` from `AI/`, install dependencies
- [x] Rename package, update README/branding, `.env.example` for all free sources
- [x] Verify all existing 66 tests pass in the new folder
- [x] Add `sources` config: per-connector enable flag, rate limit, schedule, timeout

### 0.2 Company registry (the key coverage multiplier)
- [x] `companies` collection: name, domain, careers URL, ATS type + board id, industries, India cities, size, last verified
- [~] Seed list of 2,000+ employers hiring in India — **120 verified live so far** (probe script + admin "add by careers URL" to grow it)
- [x] **ATS auto-detection script:** given a careers URL, detect Workday / Darwinbox / Keka / Zoho Recruit / Greenhouse / Lever / Ashby / SmartRecruiters / SuccessFactors / Oracle / iCIMS / Workable / Recruitee / Freshteam and derive the board id
- [~] Dead boards marked automatically after 3 consecutive 404s (discovering moved boards: todo)
- [x] Admin UI: add a company by URL → auto-detect → preview jobs → enable

### 0.3 New connectors (each isolated, with health tracking)
- [x] Workday (public careers JSON endpoint, paginated, India location filter)
- [x] ~~Darwinbox~~ — blocks automated access (Cloudflare); declined by design, users add these jobs by link
- [~] Keka / Zoho Recruit / SuccessFactors / iCIMS / Freshteam — no documented public API; covered by the generic careers-page connector (schema.org JobPosting) where the site publishes it
- [x] Oracle Recruiting Cloud
- [x] Workable
- [x] Recruitee
- [x] Generic careers page (schema.org JobPosting, robots.txt respected)
- [x] Careerjet India (free partner API) — built to the documented v4 API; needs a key to verify live
- [x] Jooble (free API key) — built to the documented API; needs a key to verify live
- [x] Adzuna India (existing — widen keywords per user segment)
- [x] Keep: Greenhouse, Lever, Ashby, SmartRecruiters, Remotive, Arbeitnow
- [x] Free remote feeds: Himalayas, Remote OK (attributed), Jobicy — India/worldwide/APAC roles only
- [x] Teamtailor company boards (public jobs feed) + detection
- [x] Self-growing registry: company boards found in any fetched or pasted job link are added automatically (origin "auto")
- [x] Reliable fetching: 2 retries with backoff, per-host cooldown on HTTP 429 (honours Retry-After), plain-language network errors instead of "fetch failed"
- [x] Admin → Job discovery: interval, pause/resume, boards per run, parallel requests, timeout, per-source schedules, run now (all or one source), run history, status labels, free-key setup with test-before-save
- [x] Users see "Jobs updated X ago · next check in Y" on Home and Search
- [x] Per-connector contract tests using recorded sample responses

### 0.4 Pipeline quality
- [x] Better India location parsing (tier-2/3 cities, "Pan India", multi-city postings)
- [x] Salary parsing: LPA, per-month, per-day, CTC vs in-hand, ranges; for blue-collar roles, monthly ₹
- [x] Job categories for all segments: tech, corporate, sales, BPO, retail, logistics/delivery, healthcare, skilled trades, hospitality, teaching, government-style
- [x] Experience + education parsing (10th/12th/ITI/diploma/graduate/PG)
- [x] Cross-source duplicate removal (same job on Workday + Adzuna + Careerjet → one job, many sources)
- [x] Freshness checks: closed-job detection when a complete board stops listing a job; auto-expire unseen jobs; re-listed jobs reopen
- [x] Scam/fraud detection: payment requests, "registration fee", personal Gmail recruiters, too-good salaries, WhatsApp-only contact

### 0.5 Search
- [x] Orama search (full-text, typo-tolerant, filters, facets) + Indian job-term synonym expansion. True meaning-based (vector) search: later, needs an embeddings budget
- [x] Filters: keyword, city/radius, remote/hybrid/on-site, experience, salary, job type, category, company, posted within, source, education needed
- [x] Sort: best match for me, newest, salary
- [x] Index rebuild at startup + incremental updates on ingest
- [x] "Matched to me" blend: search relevance × personal match score

### 0.6 Job portal UI
- [x] Job Search page: search bar with suggestions, filter chips, result count, map-free city picker
- [x] Job cards: match ring, why-it-fits one-liner, freshness, salary, source label ("via Company careers page"), quick save/hide
- [~] Job detail: other open roles at the company + similar jobs done; requirements-vs-profile side-by-side and company snapshot: todo
- [x] Portal quick links: pre-filled searches on Naukri, LinkedIn, Indeed, Foundit, Instahyre, Internshala, Apna, NCS
- [x] Admin: source health dashboard, job volume by source/city/category

**Phase 0 done when:** thousands of real India jobs from 15+ sources are searchable with filters, deduplicated and fresh, and tests pass.

---

## Phase 0.5 — Product & design overhaul (added after review)

### AI that scales for free
- [x] Hybrid AI: user's own free Google AI Studio key first (not metered), then the owner's shared pool with a daily allowance, then rules
- [x] Guided "Unlock unlimited AI" window (3 steps, clickable AI Studio link, privacy notice, test before save); keys AES-256-GCM encrypted, never returned
- [x] Admin → AI setup: add/test/disable Gemini, Groq, OpenRouter, Cerebras keys; newest stable Gemini Flash models detected automatically; today's usage
- [x] Assistant can navigate the app ("open my saved jobs"); says plainly why it's in basic mode, with a one-tap fix

### Honest matching
- [x] Location counts: jobs outside preferred cities capped at Fair (unless remote / Pan-India / open to relocate), with the reason shown
- [x] Plain-language bands: Excellent 80+ · Good 65–79 · Fair 50–64
- [x] "For you" shows true totals per band (no silent top-60), paging, filters and sorting, "new since your last visit"
- [x] Diagnosis when there are no excellent matches: cities holding good-fit jobs, related roles with live job counts, recurring missing skills — each with one-tap fixes
- [x] Fixed: structured remote/hybrid signals now outrank passing mentions in descriptions

### Design system & screens (light theme)
- [x] Tokens, display font, cards with depth, skeleton loaders, toasts, modals, tabs, company marks, score rings with band labels
- [x] App shell: sidebar (desktop), bottom bar (mobile), Ctrl+K command palette, URL routing (back/forward/bookmarks)
- [x] New: Home dashboard (journey, stats, next steps, top picks, AI status), For you, Settings
- [x] Redesigned: sign-in, onboarding, job cards, search, job detail (two-column, panel that stays in view), profile (chip editors), applications board, assistant, admin

### First impression ("wow factor")
- [x] Public landing page: animated AI hero (resume → AI core → real live jobs), live counters from real data, "Try it now" search of the real index without signing up, how it works, features, who it's for, trust, FAQ
- [x] Landing shows instantly for new visitors (no blank loading screen)
- [x] Welcome tour on first sign-in (4 steps)
- [x] Assistant shows its working steps while it thinks
- [x] Celebrations on applied / interview / offer; animated counters on the dashboard
- [x] Public endpoints expose safe fields only, rate-limited, private jobs never shown (tested)

---

## Phase 0.6 — Brand, assistant 2.0, analytics, SEO (added 2026-09-24)

### Brand
- [x] Name **MyCareer.AI** everywhere; hosted at https://app.tiaslab.in (`SITE_URL`)
- [x] Logo "Career Target" (chosen 2026-09-24): freestanding peacock rings opening like a C, arrow landing in a gold centre — app mark (`public/favicon.svg`), archer illustration (`public/brand/archer.svg`), PNG icons + 1200×630 share image (`npx tsx scripts/brand-assets.ts`); options sheet in `design/logo-options.html`

### Assistant 2.0
- [x] Docked side panel (the page stays usable), expand to a focused wide view, full screen on phones
- [x] Streaming answers (typed out as the model writes), Stop button, retry on failure
- [x] Real progress: only the tools actually used ("Searching your matches → Found 6 jobs"), collapsible
- [x] Instant replies for greetings, thanks, "no thanks", bye — no model call
- [x] Knows the current page / job ("Why do I match this job?")
- [x] `get_profile_advice`: data-backed advice (skill gaps with job counts, cities, related roles) instead of generic tips
- [x] Rich answers: job cards with Save, change cards with **Undo**, confirmation cards
- [x] Copy, 👍/👎 (stored for review), regenerate, New chat, context-aware follow-up chips, voice input (English/Hindi), replies in the user's language

### Analytics (Google Analytics for Firebase, G-BZF7F9KEWM)
- [x] Consent first (DPDP): nothing is collected until "Allow"; can be changed in Settings; no personal data in events
- [x] Page views for #routes; key events: sign_up, resume_uploaded, onboarding_complete, ai_key_added, apply_click, application_applied, application_interview, application_offer
- [x] Engagement events: search, filter_used, job_view, job_save, assistant_open/message/feedback/undo/action

### SEO
- [x] Full head: title/description, canonical, Open Graph + X cards, icons, manifest, JSON-LD (Organization, WebSite + search, WebApplication, FAQ)
- [x] Public server-rendered pages: every live job (`/jobs/<slug>-<id>`, JobPosting data for Google Jobs), `/jobs-in-<city>`, `/<role>-jobs`, `/<role>-jobs-in-<city>`, fresher/remote/part-time/internship
- [x] Rules: thin pages (<3 jobs) and search results are noindex; closed jobs noindex without JobPosting; private/suspicious jobs 404; aliases and old slugs 301; real 404s in production (no soft 404s)
- [x] robots.txt, sitemap index (listing pages + all live jobs in 5,000-URL files)
- [x] Landing page links to city/role pages; signed-in app lazy-loaded (landing bundle 1.1 MB → 0.6 MB)
- [ ] After deploy: verify `app.tiaslab.in` in Google Search Console and submit `/sitemap.xml`; add the domain to Firebase Auth authorized domains
- [ ] Hindi (`hreflang`) versions of the public pages — with Phase 1.5

## Phase 1 — Career Understanding Engine

### 1.1 Multiple ways in
- [ ] Resume upload (PDF/DOCX/DOC/TXT — existing)
- [ ] LinkedIn profile PDF import (a dedicated parser for the "Save to PDF" layout)
- [ ] Paste text
- [ ] **No-resume path:** conversational profile building (type or speak)
- [ ] Photo of a printed resume → AI reads the image (Gemini vision, free tier)

### 1.2 Confidence model
- [ ] 6 areas, each scored 0–100 with the evidence behind it: target role, skills (with evidence), experience level, location & pay, availability, motivations
- [ ] Overall "Understanding" score + a clear threshold for full-power search
- [ ] Question planner: always ask the **single most useful next question** (which area has the most uncertainty × how much it changes matches)
- [ ] Quick-reply chips + free text + voice for every question
- [ ] Every fact records its source; AI guesses shown as "Is this right?" and never used as fact until confirmed
- [ ] Re-assess on every new fact; show "What I understand about you" in a readable card

### 1.3 Role discovery
- [ ] Suggest 2–4 role paths with evidence + live job counts + typical salary
- [ ] Adjacent-role map (e.g. support + SQL → BA / Implementation / QA)
- [ ] Honest market check: "few openings for this profile in your city" → alternatives and a bridge plan
- [ ] User picks or edits their target roles; the profile updates

### 1.4 Resume builder
- [ ] Generate a resume from the profile/conversation (facts only)
- [ ] 3 clean ATS-safe templates + PDF download
- [ ] Hindi → English resume conversion (resume stays in English, the conversation can be Hindi)
- [ ] Resume Health check (ATS score out of 100 with specific fixes)

### 1.5 Language & voice
- [ ] Translation framework (English + Hindi UI strings)
- [ ] AI converses in the user's language; data is stored in English
- [ ] Voice input (browser Web Speech API) + read-aloud replies
- [ ] Large-text / simple mode for first-time smartphone users

**Phase 1 done when:** a user with no resume can speak in Hindi for 3 minutes and end with a confident profile, a generated resume and matched jobs.

---

## Phase 2 — Placement Companion

- [ ] Placement journey stages: Understanding → Searching → Applying → Interviewing → Offer → Placed (visible progress)
- [ ] **Mission Control dashboard:** today's plan, journey progress, new strong matches, upcoming interviews, application pulse, agent activity timeline
- [ ] Next-best-actions engine (ranked): interview prep, follow-ups due, unfinished applications, new strong matches, profile gaps, resume fixes, skill to learn
- [ ] Proactive assistant: the agent starts conversations (new matches, reminders, nudges after silence)
- [ ] Weekly plan: goals (apply X, practise Y, learn Z), auto-adjusted from results
- [ ] Diagnosis from outcomes: many applications / no responses → fix the resume or change level; interviews / no offers → interview coaching
- [ ] Agent activity timeline: everything the agent did, and why (transparency)
- [ ] Streaming chat replies (SSE) + tool progress ("Searching 18 sources…")
- [ ] Chrome built-in Gemini Nano on the user's device for light chat, when available
- [ ] "I got placed" flow: celebrate, confirm details, pause search, career-growth mode
- [ ] In-app notification centre (+ optional email digest)

**Phase 2 done when:** a returning user sees exactly what to do today, and the assistant stays with them through the whole journey.

---

## Phase 3 — Apply & Interview

- [ ] Tailored resume + cover letter with truthfulness checks (existing, polish the UI)
- [ ] Side-by-side diff: original vs. tailored, with each change explained
- [ ] **Pipeline board:** drag cards Saved → Preparing → Applied → Interview → Offer / Rejected; list view too
- [ ] Interview dates with calendar (.ics) download
- [ ] **Interview Prep per job:** likely questions (technical / behavioural / role / gap), your matching stories (STAR), questions to ask the employer, day-before checklist
- [ ] **Mock interview:** voice or text, one question at a time, feedback on structure, clarity, evidence and length; score history
- [ ] Message drafts: follow-up, thank-you, withdrawal, accept, salary negotiation (claim-checked)
- [ ] Offer comparison: in-hand estimate, commute, growth, benefits side by side
- [ ] Salary negotiation helper grounded in benchmark data

**Phase 3 done when:** a user can take a job from match → tailored resume → applied → prepped → offer, all tracked.

---

## Phase 4 — Bridge Features

### 4.1 Bring jobs from any portal (web only)
- [ ] "Add a job" page: paste a Naukri / LinkedIn / Indeed / Foundit / Apna link or description → parsed, scored, added to the feed (existing base, polish)
- [ ] Bulk paste: several links at once
- [ ] Bookmarkable add-job URL (`/add-job?url=…`) so users can save it in their browser
- [ ] Application form helper: copy-ready answers (name, experience, notice period, CTC, screening answers) from the approved profile — the user fills and submits

### 4.2 Job-alert email forwarding
- [ ] Personal address per user (`u-xxxx@in.mycareer…`) via Cloudflare Email Routing + Worker → our webhook
- [ ] Parsers for Naukri / LinkedIn / Indeed / Foundit / Instahyre alert formats, plus an AI fallback
- [ ] Forwarding verification + spam protection + per-user limits

### 4.3 Employer side (free job posting)
- [ ] Employer sign-up (Google) + company verification (domain email / GST optional)
- [ ] Post a job in 60 seconds (AI turns a rough description into a structured posting); blue-collar friendly form
- [ ] Moderation: scam rules + AI review + manual queue in admin
- [ ] Candidates see "Posted directly by employer" and apply in-app
- [ ] Employer inbox: ranked candidates with match explanations (the candidate chooses to share their profile)
- [ ] Anti-abuse: rate limits, reporting, block lists

**Phase 4 done when:** jobs from any portal flow in via link/paste/email, and local employers can post and receive matched candidates.

---

## Phase 5 — Insights, Polish, Launch

### 5.1 Career insights
- [ ] **Learning ROI:** re-score the user's jobs as if they had each missing skill → "Learn X → +N strong matches"
- [ ] Free learning links for each skill (official docs, NPTEL, YouTube, free certifications)
- [ ] Salary benchmarks: typical low/middle/high pay by role & city, with number of postings shown
- [ ] Funnel analytics: response, interview and offer rates, days to response, weekly activity
- [ ] Market pulse: skills in demand, top hiring companies, remote/hybrid split, trends

### 5.2 World-class UI/UX
- [ ] Design system: tokens, typography scale, components — **light theme only**
- [ ] App layout: sidebar (desktop), bottom nav (mobile), responsive down to 360px
- [ ] Command palette (Ctrl+K): jump anywhere, run agent actions
- [ ] Keyboard shortcuts on job lists (J/K to move, S to save, H to hide)
- [ ] Skeleton loaders, optimistic updates, smooth transitions (respecting reduced-motion)
- [ ] Empty states that guide the next step
- [ ] Low-data mode for slow networks
- [ ] Accessibility: WCAG 2.2 AA, screen-reader labels, focus order, contrast
- [ ] More languages: Tamil, Telugu, Kannada, Marathi, Bengali, Malayalam, Gujarati
- [ ] Shareable public profile page (optional, user-controlled) for recruiters

### 5.3 Trust, privacy, operations
- [ ] Privacy centre: see/download/delete all data, control what's shared
- [ ] Firestore rules deny all client access (server-only)
- [ ] AI free-quota protection: caching, daily allowance per user, provider cooldowns, usage dashboard
- [ ] Error monitoring + structured logs
- [ ] Full test suite: unit, connectors, pipeline, API journey, safety/adversarial, UI smoke
- [ ] Deploy guide: Cloud Run + Firebase, env setup, free-tier limits and how to stay within them
- [ ] Updated README with an honest status section

**Launch when:** all phases green, a real click-through on desktop + mobile, and real AI keys verified.

---

## What makes it world-class (vs. other job apps)

1. **Understands the person, not just keywords:** a confidence-driven conversation instead of a form. It works without a resume, in Hindi, by voice.
2. **Honest and explainable:** every match says why, what's missing and how sure it is. It never fabricates.
3. **Stays until placement:** a proactive companion with a plan, not a search box.
4. **Covers the whole market legitimately:** employer careers systems + free APIs + portal jobs users paste or forward + direct employer posts.
5. **Does the hard work:** tailored resumes, interview prep, mock interviews, follow-ups, negotiation.
6. **Tells you what to learn with numbers:** "Learn SQL → 23 more strong matches."
7. **For all of India:** from a delivery partner in Indore to a senior engineer in Bengaluru.
