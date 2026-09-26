// Learning ROI: re-score the jobs this person is already looking at as if they had one more skill, and report how many
// would move up. The numbers come from the same matching engine as the rest of the app, so they are consistent.
import type { CandidateProfile, Job } from "../../shared/types.js";
import type { LearnLink, LearningRoi, SkillRoi } from "../../shared/insights.js";
import { computeMatch } from "../matching/engine.js";
import { candidateJobs } from "../matching/service.js";
import { categoryOf, displayName } from "../nlp/skills.js";

const yt = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/** Official documentation and well-known free courses. Keys are skill keys; anything else gets free search links. */
const OFFICIAL: Record<string, LearnLink[]> = {
  python: [{ label: "Official Python tutorial", url: "https://docs.python.org/3/tutorial/", free: true }],
  javascript: [{ label: "MDN: Learn web development", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development", free: true }],
  typescript: [{ label: "TypeScript documentation", url: "https://www.typescriptlang.org/docs/", free: true }],
  react: [{ label: "React: Learn", url: "https://react.dev/learn", free: true }],
  nodejs: [{ label: "Node.js: Learn", url: "https://nodejs.org/en/learn", free: true }],
  java: [{ label: "Dev.java: Learn", url: "https://dev.java/learn/", free: true }],
  git: [{ label: "Pro Git (free book)", url: "https://git-scm.com/book", free: true }],
  docker: [{ label: "Docker: Get started", url: "https://docs.docker.com/get-started/", free: true }],
  kubernetes: [{ label: "Kubernetes tutorials", url: "https://kubernetes.io/docs/tutorials/", free: true }],
  sql: [{ label: "SQLBolt: interactive lessons", url: "https://sqlbolt.com/", free: true }],
  html: [{ label: "MDN: HTML", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content", free: true }],
  css: [{ label: "MDN: CSS", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics", free: true }],
  scrum: [{ label: "The Scrum Guide", url: "https://scrumguides.org/", free: true }],
  agile: [{ label: "Agile Manifesto and principles", url: "https://agilemanifesto.org/", free: true }],
  jira: [{ label: "Atlassian: Jira guides", url: "https://www.atlassian.com/software/jira/guides", free: true }],
  power_bi: [{ label: "Microsoft Learn: Power BI", url: "https://learn.microsoft.com/en-us/power-bi/", free: true }],
  azure: [{ label: "Microsoft Learn: Azure", url: "https://learn.microsoft.com/en-us/training/azure/", free: true }],
  aws: [{ label: "AWS free digital training", url: "https://aws.amazon.com/training/digital/", free: true }],
  machine_learning: [{ label: "Google: Machine Learning Crash Course", url: "https://developers.google.com/machine-learning/crash-course", free: true }],
};

export function linksFor(key: string, name: string): LearnLink[] {
  const free = true as const;
  return [
    ...(OFFICIAL[key] || []),
    { label: `Free ${name} courses on YouTube`, url: yt(`learn ${name} full course for beginners`), free },
    { label: "SWAYAM: free courses from Indian universities", url: `https://swayam.gov.in/explorer?searchText=${encodeURIComponent(name)}`, free },
  ].slice(0, 3);
}

const withSkill = (p: CandidateProfile, key: string): CandidateProfile => ({
  ...p, skills: [...p.skills, { name: displayName(key), key, category: categoryOf(key) as never, source: "user", confidence: 1 }],
});

export async function learningRoi(p: CandidateProfile, maxSkills = 8): Promise<LearningRoi> {
  const jobs: Job[] = (await candidateJobs(p.uid)).slice(0, 800);
  const mine = new Set(p.skills.filter((s) => s.source !== "ai_derived").map((s) => s.key));
  const base = new Map(jobs.map((j) => [j.id, computeMatch({ profile: p, job: j })]));
  // Only jobs the person could realistically move on: near misses, not hopeless ones and not already excellent.
  const near = jobs.filter((j) => { const m = base.get(j.id)!; return m.score >= 35 && m.score < 80 && m.hardFailures.length === 0; });
  const askedBy = new Map<string, Job[]>();
  for (const j of near) for (const k of j.skills) if (!mine.has(k)) (askedBy.get(k) || askedBy.set(k, []).get(k)!).push(j);
  const candidates = [...askedBy.entries()].filter(([, js]) => js.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 14);

  const out: SkillRoi[] = [];
  for (const [key, js] of candidates) {
    const profile = withSkill(p, key);
    let strong = 0, excellent = 0;
    for (const j of js) {
      const before = base.get(j.id)!.score, after = computeMatch({ profile, job: j }).score;
      if (before < 65 && after >= 65) strong++;
      if (before < 80 && after >= 80) excellent++;
    }
    if (strong > 0 || excellent > 0) out.push({ key, skill: displayName(key), newStrong: strong, newExcellent: excellent, jobsAsking: js.length, links: linksFor(key, displayName(key)) });
  }
  out.sort((a, b) => b.newStrong - a.newStrong || b.newExcellent - a.newExcellent);
  return {
    skills: out.slice(0, maxSkills), jobsChecked: jobs.length,
    note: out.length ? undefined : jobs.length < 20 ? "There aren't enough jobs in your pool yet for a reliable answer. Check back as more jobs arrive." : "No single missing skill would move many of your jobs up right now. That usually means your matches are already limited by location, level or role rather than skills.",
  };
}
