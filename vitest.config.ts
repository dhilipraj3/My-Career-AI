import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "true",
      DISCOVERY_INTERVAL_MINUTES: "0",
      DAILY_AI_CREDITS: "100",
      USER_RATE_LIMIT_PER_MIN: "100000",
      GEMINI_API_KEY: "",
      FALLBACK_AI_API_KEY: "",
      ADMIN_EMAILS: "admin@dev.local",
    },
    testTimeout: 20000,
  },
});
