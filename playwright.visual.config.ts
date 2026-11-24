import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Auditoría visual/responsive (no corre con la suite E2E normal). */
export default defineConfig({ ...base, testDir: "tests/visual", projects: [{ name: "chromium", use: { browserName: "chromium" } }] });
