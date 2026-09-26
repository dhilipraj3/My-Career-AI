import compression from "compression";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { buildRouter, errorHandler } from "./routes.js";
import { requestContext } from "./log.js";
import { employerRedirect } from "./employer/routes.js";
import { seoRouter } from "./seo/index.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://www.gstatic.com", "https://www.googletagmanager.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseapp.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com", "ws:", "wss:"],
          frameSrc: ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com"],
        },
      },
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // required for Google sign-in popup
    }),
  );
  app.use(requestContext());
  // Gzip responses — except the assistant's live stream, which must reach the browser as it's written.
  app.use(compression({ filter: (req, res) => !req.path.endsWith("/stream") && compression.filter(req, res) }));
  app.use(express.json({ limit: "1mb" }));
  app.use(employerRedirect());
  app.use(seoRouter());
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } }));
  app.use("/api", buildRouter());
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
