// Detects the careers system behind one or more careers URLs and previews India jobs.
// Usage: npm run detect:ats -- https://company.com/careers [more urls…]
import { regionOk } from "../server/jobs/discovery.js";
import { detectAts } from "../server/jobs/detect.js";
import { fetcherFor } from "../server/jobs/registry.js";

const urls = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
if (!urls.length) {
  console.log("Usage: npm run detect:ats -- <careers url> [more urls…]");
  process.exit(1);
}
for (const url of urls) {
  try {
    const d = await detectAts(url);
    if (!d.ats) {
      console.log(`${url}\n  ✗ ${d.unsupported || d.evidence}`);
      continue;
    }
    const jobs = await fetcherFor(d.ats)(d.board).catch((e) => { throw new Error(`detected ${d.ats} but fetching failed: ${e.message}`); });
    const india = jobs.filter(regionOk);
    console.log(`${url}\n  ✓ ${d.ats} board="${d.board}" (${d.evidence}) — ${india.length} India-relevant of ${jobs.length}`);
    for (const j of india.slice(0, 3)) console.log(`    · ${j.title} — ${j.location}`);
    console.log(`  seed entry: ${JSON.stringify({ name: "<Company>", ats: d.ats, board: d.board, careersUrl: url })}`);
  } catch (e: any) {
    console.log(`${url}\n  ✗ ${e.message}`);
  }
}
