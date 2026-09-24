// How much memory this server really has. Containers (Render, Docker) limit memory with cgroups, while the OS still
// reports the whole host's RAM — so read the cgroup limit first.
import fs from "node:fs";
import os from "node:os";

export function containerMemoryMB(): number {
  const read = (f: string) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
  const v2 = read("/sys/fs/cgroup/memory.max"); // cgroup v2: bytes or "max"
  if (v2 && v2 !== "max" && Number(v2) > 0) return Math.round(Number(v2) / 1048576);
  const v1 = read("/sys/fs/cgroup/memory/memory.limit_in_bytes"); // cgroup v1 (huge number when unlimited)
  if (v1 && Number(v1) > 0 && Number(v1) < 2 ** 50) return Math.round(Number(v1) / 1048576);
  return Math.round(os.totalmem() / 1048576);
}

/** Small servers (Render free = 512 MB) get gentler defaults for background work. */
export const isSmallServer = () => containerMemoryMB() <= 1024;
