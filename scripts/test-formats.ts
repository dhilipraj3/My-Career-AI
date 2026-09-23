// Verifies PDF and DOCX extraction with real binary files produced by real tools:
//   PDF  -> Microsoft Edge headless "print to PDF" (a Chromium/Skia PDF, like many real resumes)
//   DOCX -> a valid OOXML package zipped with Windows tar (forward-slash entries)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractResumeText } from "../server/resume/extract.js";
import { deterministicParse } from "../server/resume/parse.js";
import { RESUME_TEXT } from "../tests/fixtures.js";

const work = path.resolve("data/_formats");
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const report = (label: string, r: any) => {
  if ("error" in r) return console.log(`${label}: FAIL ${r.error}`);
  const p = deterministicParse(r.text);
  const ok = p.fullName === "Priya Sharma" && p.experience.length === 2 && p.totalExperienceYears > 9 && p.skills.length >= 8;
  console.log(`${label}: ${ok ? "OK" : "PARSE-MISMATCH"} format=${r.format} chars=${r.text.length} -> name="${p.fullName}" role="${p.currentRole}" jobs=${p.experience.length} skills=${p.skills.length} years=${p.totalExperienceYears} edu=${p.education[0]?.degree}`);
  if (!ok) process.exitCode = 1;
};

// ---- PDF via Edge ----
const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
if (!edge) console.log("PDF: SKIPPED (no Edge/Chrome found)");
else {
  const html = path.join(work, "resume.html");
  const body = RESUME_TEXT.split("\n").map((l) => (/^[A-Z ]{4,}$/.test(l) ? `<h3>${esc(l)}</h3>` : l.startsWith("•") ? `<li>${esc(l.slice(1).trim())}</li>` : `<p>${esc(l)}</p>`)).join("\n");
  fs.writeFileSync(html, `<html><body style="font-family:Arial;font-size:11pt">${body}</body></html>`);
  const pdf = path.join(work, "resume.pdf");
  try {
    execFileSync(edge, ["--headless", "--disable-gpu", `--print-to-pdf=${pdf}`, "--no-pdf-header-footer", `file:///${html.replace(/\\/g, "/")}`], { stdio: "ignore", timeout: 60000 });
  } catch { /* edge exits non-zero sometimes even when it wrote the file */ }
  if (!fs.existsSync(pdf)) console.log("PDF: SKIPPED (browser did not produce a file)");
  else report("PDF ", await extractResumeText(fs.readFileSync(pdf), "resume.pdf").catch((e) => ({ error: e.message })));
}

// ---- DOCX via tar ----
const dx = path.join(work, "docx");
fs.mkdirSync(path.join(dx, "_rels"), { recursive: true });
fs.mkdirSync(path.join(dx, "word"), { recursive: true });
const paras = RESUME_TEXT.split("\n").map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("");
fs.writeFileSync(path.join(dx, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
fs.writeFileSync(path.join(dx, "_rels", ".rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
fs.writeFileSync(path.join(dx, "word", "document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
const zip = path.join(work, "resume.zip"); // tar -a chooses the archive format from the extension
execFileSync("tar", ["-a", "-c", "-f", zip, "-C", dx, "[Content_Types].xml", "_rels", "word"]);
const docx = path.join(work, "resume.docx");
fs.renameSync(zip, docx);
report("DOCX", await extractResumeText(fs.readFileSync(docx), "resume.docx").catch((e) => ({ error: e.message })));

fs.rmSync(work, { recursive: true, force: true });
