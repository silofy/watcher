import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/saira";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/spline-sans-mono";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
