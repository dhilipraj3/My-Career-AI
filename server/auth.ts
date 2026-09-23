import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { verifyIdToken } from "./db/firebaseAdmin.js";

export interface AuthedUser {
  uid: string;
  email?: string;
  name?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}

/**
 * Verifies a Firebase ID token from `Authorization: Bearer <token>`.
 * With DEV_AUTH_BYPASS=true (never in production) `Bearer dev:<uid>` is accepted so the app is testable offline.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });

  if (config.devAuthBypass && token.startsWith("dev:")) {
    const uid = token.slice(4).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    if (!uid) return res.status(401).json({ error: "Invalid dev token" });
    req.user = { uid, email: `${uid}@dev.local`, name: uid };
    return next();
  }

  try {
    req.user = await verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
  }
}
