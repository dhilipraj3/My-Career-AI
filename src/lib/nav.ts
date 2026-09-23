import { createContext, useContext } from "react";

export type Page = "home" | "matches" | "search" | "applications" | "resume" | "profile" | "settings" | "admin";
export const PAGES: Page[] = ["home", "matches", "search", "applications", "resume", "profile", "settings", "admin"];

export interface Route {
  page: Page;
  jobId: string | null;
  params: URLSearchParams;
}

/** The URL hash is the source of truth, so back/forward, refresh and bookmarks all work: #matches, #search?q=react, #job/<id>. */
export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  if (path.startsWith("job/")) return { page: "matches", jobId: decodeURIComponent(path.slice(4)) || null, params };
  return { page: (PAGES as string[]).includes(path) ? (path as Page) : "home", jobId: null, params };
}

export const hrefFor = (page: Page, params?: Record<string, string>) => {
  const q = params ? new URLSearchParams(params).toString() : "";
  return `#${page === "home" ? "" : page}${q ? `?${q}` : ""}`;
};

export interface Nav {
  go: (page: Page, params?: Record<string, string>) => void;
  openJob: (id: string) => void;
  openChat: (prompt?: string) => void;
  openAiSetup: () => void;
  refresh: () => Promise<void>;
}

export const NavCtx = createContext<Nav>({ go: () => undefined, openJob: () => undefined, openChat: () => undefined, openAiSetup: () => undefined, refresh: async () => undefined });
export const useNav = () => useContext(NavCtx);
