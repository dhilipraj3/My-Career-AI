import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analytics";
import { applyStoredLargeText } from "./lib/i18n";
import { applyStoredLowData } from "./lib/lowdata";
import { applyTheme } from "./lib/theme";

initAnalytics();
applyStoredLargeText();
applyStoredLowData();
applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
