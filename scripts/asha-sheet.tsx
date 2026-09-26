// Renders every pose of Asha side by side (screenshots/asha-sheet.png) to check the character by eye.
// Run: npx tsx scripts/asha-sheet.tsx
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer from "puppeteer-core";
import Asha from "../src/components/Asha";

const poses = ["idle", "talking", "listening", "thinking", "pointing", "celebrating", "encouraging", "waving"] as const;
const cells = poses.map((p) => `<figure>${renderToStaticMarkup(<Asha pose={p} mouthOpen={p === "talking"} className="a" />)}<figcaption>${p}</figcaption></figure>`).join("");
const html = `<html><body style="margin:0;background:#0b1621;font-family:sans-serif"><div style="display:grid;grid-template-columns:repeat(4,260px);gap:12px;padding:16px">${cells}</div>
<style>figure{margin:0;background:#122130;border-radius:16px;padding:10px;text-align:center;color:#c8d5de}.a{width:230px;height:274px;overflow:visible}</style></body></html>`;
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))!;
const b = await puppeteer.launch({ executablePath: edge, headless: true });
const pg = await b.newPage();
await pg.setViewport({ width: 1110, height: 640 });
await pg.setContent(html);
await pg.screenshot({ path: "screenshots/asha-sheet.png", fullPage: true });
await b.close();
