// Production launcher: gives Node a heap limit that fits the container (Node's default ignores container limits and
// was too small/unsafe on 512 MB instances), then runs the server and passes shutdown signals through so the server
// can save its data before the platform stops it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

function containerMB() {
  const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const v2 = read("/sys/fs/cgroup/memory.max");
  if (v2 && v2 !== "max" && Number(v2) > 0) return Number(v2) / 1048576;
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (v1 && Number(v1) > 0 && Number(v1) < 2 ** 50) return Number(v1) / 1048576;
  return os.totalmem() / 1048576;
}

const total = containerMB();
// ~60% for the JS heap; the rest is for code, network buffers and the operating system.
const heap = Math.max(192, Math.min(4096, Math.round(total * 0.6)));
console.log(`[start] container memory ${Math.round(total)} MB → heap limit ${heap} MB`);
const child = spawn(process.execPath, [`--max-old-space-size=${heap}`, "--import", "tsx", "server/index.ts"], { stdio: "inherit", env: process.env });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
