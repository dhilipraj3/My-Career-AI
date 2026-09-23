import { setProviders } from "../server/ai/gateway.js";
import type { AiProvider, GenerateRequest } from "../server/ai/providers.js";
import { setStore, FileStore } from "../server/db/store.js";
import { setConnectors } from "../server/jobs/discovery.js";
import type { JobConnector } from "../server/jobs/connectors.js";
import type { RawJob } from "../server/jobs/normalize.js";

export const RESUME_TEXT = `Priya Sharma
Senior Project Manager
priya.sharma@example.com | +91 98765 43210 | Chennai, Tamil Nadu
linkedin.com/in/priyasharma

SUMMARY
Delivery-focused project manager with a track record of running large software programs across banking clients.

EXPERIENCE
Senior Project Manager — Infosys Limited
Jan 2019 - Present
• Led a team of 25 engineers delivering a core banking platform using Agile and Scrum
• Reduced release cycle time by 30% by introducing CI/CD pipelines with Jenkins
• Managed stakeholder communication, risk management and a project budget of 4 crore
• Coordinated vendor management and resource planning across three geographies

Project Manager — Cognizant
Jun 2014 - Dec 2018
• Delivered 12 web applications on time using JIRA and Agile methodology
• Managed budgets, project planning and reporting for offshore development teams
• Mentored 6 junior project coordinators

EDUCATION
B.Tech in Computer Science, Anna University, 2013

SKILLS
Project Management, Agile, Scrum, JIRA, Stakeholder Management, Risk Management, Budget Management, MS Project, CI/CD, SQL

CERTIFICATIONS
PMP - Project Management Institute, 2017
Certified ScrumMaster, 2016
`;

export class FakeProvider implements AiProvider {
  calls: GenerateRequest[] = [];
  constructor(public id: string, public handler: (req: GenerateRequest) => string | Promise<string>, public up = true) {}
  available() { return this.up; }
  async generate(req: GenerateRequest) {
    this.calls.push(req);
    return { text: await this.handler(req), tokensIn: 10, tokensOut: 10 };
  }
}

export function freshEnv(opts: { gemini?: FakeProvider | null; fallback?: FakeProvider | null } = {}) {
  setStore(new FileStore()); // in-memory
  const providers: AiProvider[] = [];
  if (opts.gemini) providers.push(opts.gemini);
  if (opts.fallback) providers.push(opts.fallback);
  setProviders(providers);
  setConnectors([]);
}

export function fakeConnector(id: string, jobs: RawJob[] | (() => Promise<RawJob[]>)): JobConnector {
  return { id, name: id, kind: "ats", access: "test", terms: "test", isConfigured: () => true, fetch: async () => (typeof jobs === "function" ? jobs() : jobs) };
}

export const pmJobDescription = `We are hiring a Senior Project Manager to lead software delivery programs for our banking clients in Chennai.
You will run Agile and Scrum teams, manage stakeholders, risk management and budgets, and coordinate vendor management.
Requirements: 8+ years of experience in project management, strong JIRA and MS Project skills, PMP certification is a plus.
Experience with CI/CD tooling is desirable. Salary: 25-32 LPA. This is a full-time role based in Chennai (hybrid).`;

export function rawJob(over: Partial<RawJob> = {}): RawJob {
  return {
    connector: "greenhouse", sourceName: "Greenhouse · Acme", sourceJobId: "1", title: "Senior Project Manager", company: "Acme Technologies Pvt Ltd", location: "Chennai, India",
    description: pmJobDescription, url: "https://boards.greenhouse.io/acme/jobs/1", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", postedAt: new Date().toISOString(), ...over,
  };
}
