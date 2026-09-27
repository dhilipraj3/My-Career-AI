// One number that answers "can I get a job right now?", combining the three things that actually drive it: a
// complete profile, an understood profile (Asha knows enough to help), and jobs that actually fit. Pure and
// testable so the dashboard's headline number never drifts from what it claims to summarise.
export interface ReadinessInputs {
  profileCompleteness: number; // 0..100
  understanding: number; // 0..100
  matches: { total: number; excellent: number; good: number };
}

export interface Readiness {
  score: number; // 0..100
  label: string;
  detail: string;
}

/** How well the current matches say "you'd get hired", saturating so a handful of great fits already read as strong. */
function matchStrength(m: ReadinessInputs["matches"]): number {
  if (m.total === 0) return 15; // still searching: not a fault, but nothing to point to yet either
  return Math.min(100, 45 + m.excellent * 12 + m.good * 4);
}

export function readiness(i: ReadinessInputs): Readiness {
  const match = matchStrength(i.matches);
  const score = Math.round(i.profileCompleteness * 0.3 + i.understanding * 0.3 + match * 0.4);
  const weakest = ([
    ["profile", i.profileCompleteness, "Finish your profile — it's the base everything else scores against."],
    ["understanding", i.understanding, "Answer a few more questions so I can vouch for you accurately."],
    ["match", match, i.matches.total === 0 ? "I'm still searching — check back soon." : "Widen your search or add a skill to unlock stronger matches."],
  ] as const).reduce((a, b) => (b[1] < a[1] ? b : a));
  if (score >= 80) return { score, label: "You're ready to apply", detail: "Your profile is strong and your matches are good. Go for it." };
  if (score >= 55) return { score, label: "Good progress", detail: weakest[2] };
  if (score >= 30) return { score, label: "Building momentum", detail: weakest[2] };
  return { score, label: "Let's get you ready", detail: weakest[2] };
}
