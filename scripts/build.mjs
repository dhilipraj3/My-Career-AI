// Builds the web app as a real production build. The local .env sets NODE_ENV=development for the server, and Vite
// would pick that up (development React, slower, components mounted twice), so production is forced here before Vite
// starts. Extra arguments are passed on (e.g. --outDir dist-shots).
import { spawnSync } from "node:child_process";

const vite = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(vite, ["vite", "build", ...process.argv.slice(2)], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, NODE_ENV: "production" } });
process.exit(r.status ?? 1);
