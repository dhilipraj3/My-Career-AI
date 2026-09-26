// Personal forwarding address per user (u-xxxx@<domain>): the user forwards job-alert emails from their own inbox, and
// the jobs land in their private feed. Emails arrive from a Cloudflare Email Routing worker (see deploy/).
import crypto from "node:crypto";
import { simpleParser } from "mailparser";
import { config } from "../config.js";
import { getStore } from "../db/store.js";
import { audit } from "../audit.js";
import { rawJobFromDescription } from "../jobs/connectors.js";
import { ingestRawJobs } from "../jobs/ingest.js";
import { matchCandidate } from "../matching/service.js";
import { notify } from "../notifications.js";
import { getProfile } from "../profile/service.js";
import { parseAlertEmail, type InboundMail } from "./parse.js";

export interface InboundEvent { at: string; kind: "alerts" | "verification" | "empty" | "ignored" | "limit"; jobs: number; portal?: string; from?: string; subject?: string }
export interface InboundRecord {
  id: string; // the address token
  uid: string;
  createdAt: string;
  day: string;
  emailsToday: number;
  jobsToday: number;
  verification?: { code?: string; link?: string; at: string };
  events: InboundEvent[];
}

export const LIMITS = { emailsPerDay: 40, jobsPerDay: 60, maxEvents: 15 };
const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
const newToken = () => Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
const today = () => new Date().toISOString().slice(0, 10);

export const inboundDomain = () => config.inboundEmail.domain;
export const inboundEnabled = () => Boolean(config.inboundEmail.domain && config.inboundEmail.secret);
export const addressOf = (token: string) => `u-${token}@${inboundDomain()}`;

/** The token in "u-<token>@domain", or null when the address isn't one of ours. */
export function tokenFromAddress(to: string): string | null {
  const m = /u-([a-z0-9]{8})@([a-z0-9.-]+)/i.exec(to.toLowerCase());
  return m && m[2] === inboundDomain().toLowerCase() ? m[1] : null;
}

export async function getInbox(uid: string): Promise<InboundRecord> {
  const store = await getStore();
  const found = (await store.query<InboundRecord>("inbound", { where: { uid } }))[0];
  if (found) return found;
  const rec: InboundRecord = { id: newToken(), uid, createdAt: new Date().toISOString(), day: today(), emailsToday: 0, jobsToday: 0, events: [] };
  await store.put("inbound", rec.id, rec);
  return rec;
}

/** A new address; the old one stops working straight away (use if it leaks or attracts spam). */
export async function rotateInbox(uid: string): Promise<InboundRecord> {
  const store = await getStore();
  for (const old of await store.query<InboundRecord>("inbound", { where: { uid } })) await store.del("inbound", old.id);
  return getInbox(uid);
}

const push = (rec: InboundRecord, e: Omit<InboundEvent, "at">) => { rec.events = [{ at: new Date().toISOString(), ...e }, ...rec.events].slice(0, LIMITS.maxEvents); };

/** Turn a raw MIME message into the fields we read. Bounded so a huge email can't stall the server. */
export async function readMime(raw: Buffer): Promise<InboundMail> {
  const p = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  return { from: p.from?.text || "", subject: (p.subject || "").slice(0, 300), text: (p.text || "").slice(0, 200_000), html: (typeof p.html === "string" ? p.html : "").slice(0, 400_000) };
}

export async function handleInbound(to: string, mail: InboundMail): Promise<{ accepted: boolean; kind?: InboundEvent["kind"]; jobs?: number }> {
  const token = tokenFromAddress(to);
  if (!token) return { accepted: false };
  const store = await getStore();
  const rec = await store.get<InboundRecord>("inbound", token);
  if (!rec) return { accepted: false }; // unknown or rotated address: drop silently, reveal nothing
  if (rec.day !== today()) { rec.day = today(); rec.emailsToday = 0; rec.jobsToday = 0; }
  const meta = { from: mail.from.replace(/^.*</, "").replace(/>.*$/, "").slice(0, 80), subject: mail.subject.slice(0, 100) };
  if (rec.emailsToday >= LIMITS.emailsPerDay) { push(rec, { kind: "limit", jobs: 0, ...meta }); await store.put("inbound", rec.id, rec); return { accepted: true, kind: "limit", jobs: 0 }; }
  rec.emailsToday++;

  const profile = await getProfile(rec.uid);
  const parsed = await parseAlertEmail(rec.uid, mail);
  let added = 0;
  if (parsed.kind === "verification") {
    rec.verification = { ...parsed.verification, at: new Date().toISOString() };
    push(rec, { kind: "verification", jobs: 0, ...meta });
  } else if (parsed.kind === "alerts" && profile?.status === "ready") {
    const room = Math.max(0, LIMITS.jobsPerDay - rec.jobsToday);
    const raws = parsed.jobs.slice(0, room).map((j) => {
      const raw = rawJobFromDescription({ title: j.title, company: j.company, location: j.location, url: j.url, description: `${j.title} at ${j.company}${j.location ? `, ${j.location}` : ""}. ${j.snippet} Found in your ${j.portal} job alert email. Open the original posting for the full description and to apply.` });
      raw.connector = "user_email";
      raw.sourceName = `${j.portal} alert`;
      raw.sourceJobId = `email_${crypto.createHash("sha1").update(j.url.split("?")[0] + j.title).digest("hex").slice(0, 14)}`;
      return raw;
    });
    const stats = raws.length ? await ingestRawJobs(raws, { ownerUid: rec.uid }) : { jobIds: [] as string[] };
    added = stats.jobIds.length;
    rec.jobsToday += added;
    if (added) {
      await matchCandidate(rec.uid, { jobIds: stats.jobIds });
      await notify(rec.uid, { kind: "new_jobs", title: `${added} job${added === 1 ? "" : "s"} from your ${parsed.portal || "alert"} email`, body: "I added them to your feed and scored them against your profile." });
    }
    push(rec, { kind: "alerts", jobs: added, portal: parsed.portal, ...meta });
  } else {
    push(rec, { kind: parsed.kind === "alerts" ? "ignored" : "empty", jobs: 0, ...meta }); // no profile yet, or nothing readable
  }
  await store.put("inbound", rec.id, rec);
  await audit(rec.uid, "inbound.email", { kind: parsed.kind, jobs: added });
  return { accepted: true, kind: parsed.kind, jobs: added };
}
