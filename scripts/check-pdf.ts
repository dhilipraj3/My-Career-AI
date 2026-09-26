// Renders the resume document to a real PDF with Edge, so page breaks and formatting can be checked by eye.
// Run: npx tsx scripts/check-pdf.ts  → screenshots/resume-<template>.pdf and page images.
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { resumeHtml, type ResumeDoc } from "../src/lib/resumeDoc";

const job = (n: number) => ({ title: ["Senior Project Manager", "Project Manager", "Associate Project Manager", "Business Analyst"][n % 4], company: ["Infosys Limited", "Cognizant", "Wipro", "HCL Technologies"][n % 4], period: `Jan ${2019 - n * 3} – Dec ${2021 - n * 3}`,
  bullets: ["Reduced release cycle time by 30% by introducing CI/CD pipelines with Jenkins", "Managed stakeholder communication, risk management and a project budget of ₹4 crore across three business units", "Led a team of 25 engineers delivering a core banking platform using Agile and Scrum", "Coordinated vendor management and resource planning across three geographies", "Mentored 6 junior project coordinators, two of whom were promoted within a year"] });
const doc: ResumeDoc = {
  name: "Priya Sharma", headline: "Senior Project Manager · 12 years", contact: ["priya.sharma@example.com", "+91 98765 43210", "Chennai, Tamil Nadu", "linkedin.com/in/priyasharma"],
  summary: "Delivery-focused project manager with 12 years of experience running large software programmes for banking clients. Known for calm stakeholder management, predictable delivery and building strong teams.",
  skills: ["Project Management", "Agile", "Scrum", "CI/CD", "Jenkins", "Stakeholder Management", "Risk Management", "Vendor Management", "Resource Planning", "JIRA", "Budget Management", "MS Project", "SQL", "PMP"],
  experience: [0, 1, 2, 3, 4, 5, 6].map(job), projects: [{ title: "Core banking migration", description: "Moved 2 million accounts to a new platform with zero downtime." }],
  education: [{ degree: "B.Tech in Computer Science", institution: "Anna University", year: "2013" }], certifications: ["PMP · Project Management Institute · 2017", "Certified ScrumMaster · 2016"],
};
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))!;
const browser = await puppeteer.launch({ executablePath: edge, headless: true });
const page = await browser.newPage();
fs.mkdirSync("screenshots", { recursive: true });
for (const t of ["classic", "modern", "compact"] as const) {
  await page.setContent(resumeHtml(doc, t), { waitUntil: "load", timeout: 20000 });
  await page.pdf({ path: `screenshots/resume-${t}.pdf`, format: "A4", preferCSSPageSize: true, printBackground: true });
  const pages = (fs.readFileSync(`screenshots/resume-${t}.pdf`, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`${t}: ${pages} page(s)`);
}
// A picture of how the print looks, page by page (A4 at 96 dpi, with the print margins).
await page.setViewport({ width: 794, height: 1123 });
await page.emulateMediaType("print");
await page.setContent(resumeHtml(doc, "classic"), { waitUntil: "load", timeout: 20000 });
await page.screenshot({ path: "screenshots/resume-classic-print.png", fullPage: true });
await browser.close();
