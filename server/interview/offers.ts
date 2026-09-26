// Offer comparison. In-hand pay is an ESTIMATE (new tax regime, FY 2025-26 slabs, employee PF on 40% basic, professional
// tax) and is always labelled as one; real payslips vary with the employer's salary structure.
import type { OfferAnalysis, OfferComparison, OfferInput } from "../../shared/interview.js";

const SLABS: Array<[number, number]> = [[400_000, 0], [800_000, 0.05], [1_200_000, 0.1], [1_600_000, 0.15], [2_000_000, 0.2], [2_400_000, 0.25], [Infinity, 0.3]];

export function annualTax(taxableIncome: number): number {
  if (taxableIncome <= 1_200_000) return 0; // section 87A rebate (new regime)
  let tax = 0, prev = 0;
  for (const [cap, rate] of SLABS) {
    if (taxableIncome > prev) tax += (Math.min(taxableIncome, cap) - prev) * rate;
    prev = cap;
  }
  // Marginal relief just above the rebate limit: tax can't exceed the income above ₹12L.
  tax = Math.min(tax, taxableIncome - 1_200_000);
  return Math.round(tax * 1.04); // 4% cess
}

export function monthlyInHand(fixedLPA: number): number {
  const fixed = fixedLPA * 100_000;
  const basic = fixed * 0.4;
  const pf = Math.min(basic * 0.12, 21_600); // employee PF capped on the ₹15k wage ceiling (common in offers); higher only if voluntary
  const tax = annualTax(Math.max(0, fixed - 75_000 - pf));
  return Math.round((fixed - pf - tax - 2_400) / 12);
}

export function analyseOffer(o: OfferInput): OfferAnalysis {
  const fixed = o.fixedLPA, variable = o.variableLPA || 0, bonus = (o.joiningBonusLakh || 0) / 1; // lakh = LPA units
  return { ...o, monthlyInHand: monthlyInHand(fixed), totalFirstYearLPA: Math.round((fixed + variable + bonus) * 10) / 10, estimate: true };
}

export function compareOffers(inputs: OfferInput[]): OfferComparison {
  const offers = inputs.map(analyseOffer);
  const best = <T,>(pick: (o: OfferAnalysis) => number | undefined, dir: 1 | -1 = 1) => {
    const scored = offers.filter((o) => pick(o) !== undefined);
    if (scored.length < 2) return null;
    const top = [...scored].sort((a, b) => dir * ((pick(b) as number) - (pick(a) as number)))[0];
    const tie = scored.filter((o) => pick(o) === pick(top)).length > 1;
    return tie ? null : top;
  };
  const highlights: OfferComparison["highlights"] = [];
  const add = (label: string, o: OfferAnalysis | null) => o && highlights.push({ label, company: o.company });
  add("Highest monthly in-hand", best((o) => o.monthlyInHand));
  add("Highest first-year total", best((o) => o.totalFirstYearLPA));
  add("Best growth", best((o) => o.growth));
  add("Shortest commute", best((o) => o.commuteMinutes, -1));
  add("Most work from home", best((o) => o.wfhDaysPerWeek));
  const notes = [
    "In-hand figures are estimates from fixed pay only. Ask each employer for the exact salary breakup.",
    "Variable pay and bonuses are not guaranteed. Compare fixed pay first.",
  ];
  const top = best((o) => o.monthlyInHand), other = best((o) => o.totalFirstYearLPA);
  if (top && other && top.company !== other.company) notes.push(`${top.company} pays more every month, but ${other.company} pays more in the first year overall (variable/bonus). Decide which matters more to you.`);
  return { offers, highlights, notes };
}
