// Low-data mode: for slow or metered connections and older phones. Turns off animation and confetti, and asks the
// server for smaller pages. Stored on this device only.
const KEY = "mc_lowdata";

export function getLowData(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setLowData(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  document.documentElement.classList.toggle("low-data", on);
}
export const applyStoredLowData = () => document.documentElement.classList.toggle("low-data", getLowData());
/** Page size for job lists: smaller when low-data mode is on. */
export const listPageSize = (normal = 20) => (getLowData() ? Math.min(normal, 8) : normal);
