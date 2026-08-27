import express from "express";
import { prepareHttpApp } from "./src/http-server.js";

const app = express();
let initializedApp: ReturnType<typeof prepareHttpApp> | undefined;

function productionApp() {
  initializedApp ??= prepareHttpApp();
  return initializedApp;
}

app.use(async (req, res, next) => {
  try {
    const prepared = await productionApp();
    prepared.setReady(true);
    prepared.app(req, res, next);
  } catch {
    // Configuration, AuthCo discovery, and provider readiness all fail closed.
    // Do not expose URLs, secrets, or adapter details from initialization errors.
    initializedApp = undefined;
    if (!res.headersSent) {
      res.status(503).json({ error: "service_unavailable" });
    }
  }
});

export default app;
