/**
 * Central env-var schema for Fitsy server code.
 *
 * Why this exists: silent env defaults have repeatedly cost real pipeline
 * runs (e.g. `UE_API_MODE` unset silently defaulting to `"disabled"`, raw
 * HTML fetches tripping UE bot defense — entire hex run degraded). This
 * module validates required env vars at script boot and fails LOUD (exits 1)
 * instead of letting a misconfigured run limp forward.
 *
 * Usage:
 *   import { parseServerEnv, logEnvState } from "@fitsy/shared";
 *   const env = parseServerEnv();   // exits 1 on missing/invalid required vars
 *   logEnvState(env, "preload");    // loudly prints resolved values (keys redacted)
 *
 * Services that need test-level env mocking (e.g. BraveSearchScraper,
 * UberEatsSource) should keep their inline `process.env[...]` reads —
 * this module is for boot-time validation at script entry points, not a
 * replacement for every call site.
 */
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const UE_API_MODES = ["disabled", "primary", "shadow"] as const;
export type UeApiMode = (typeof UE_API_MODES)[number];

/**
 * Validate process.env against the schema. Exits 1 with a human-readable
 * error on missing/invalid required vars. Whitespace/quotes/non-printable
 * characters in keys are rejected (common `vercel env pull` corruption).
 *
 * Optional vars are allowed to be absent, but if present they must parse.
 */
export function parseServerEnv() {
  return createEnv({
    server: {
      POSTGRES_PRISMA_URL: z.string().regex(/^\S+$/, "must not contain whitespace"),
      POSTGRES_URL_NON_POOLING: z.string().regex(/^\S+$/, "must not contain whitespace"),
      ANTHROPIC_API_KEY: z.string().regex(/^\S+$/, "must not contain whitespace"),
      FIRECRAWL_API_KEY: z.string().regex(/^\S+$/, "must not contain whitespace"),
      BRAVE_SEARCH_API_KEY: z.string().regex(/^\S+$/, "must not contain whitespace").optional(),
      AXIOM_TOKEN: z.string().regex(/^\S+$/, "must not contain whitespace").optional(),
      SUPABASE_URL: z.string().url().optional(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
      SUPABASE_ANON_KEY: z.string().min(1).optional(),
      SLACK_BOT_TOKEN: z.string().regex(/^xoxb-\S+$/, "must be a Slack bot token starting with xoxb-").optional(),
      SLACK_ALERT_CHANNEL: z.string().regex(/^[CG][A-Z0-9]{8,}$/, "must be a Slack channel ID (C… or G…)").optional(),
      UE_API_MODE: z.enum(UE_API_MODES).default("disabled"),
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    onValidationError: (error) => {
      const issues = (Array.isArray(error) ? error : [error]) as {
        path?: unknown[];
        message?: string;
      }[];
      console.error("[env] validation failed:");
      for (const issue of issues) {
        const path = Array.isArray(issue.path) ? issue.path.join(".") : "<unknown>";
        console.error(`  ${path}: ${issue.message ?? String(issue)}`);
      }
      console.error("[env] re-pull with: vercel env pull .env.local --environment=development --yes");
      process.exit(1);
    },
  });
}

export type ServerEnv = ReturnType<typeof parseServerEnv>;

function redact(key: string, value: string | undefined): string {
  if (value === undefined) return "<unset>";
  if (/KEY|TOKEN|URL|SECRET/.test(key)) {
    return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "<set>";
  }
  return value;
}

/**
 * Loudly log the resolved env state at boot so silent defaults show up in
 * pipeline logs. Secrets are redacted to first/last 4 chars.
 */
export function logEnvState(env: ServerEnv, tag = "env"): void {
  const keys: (keyof ServerEnv)[] = [
    "NODE_ENV",
    "UE_API_MODE",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "ANTHROPIC_API_KEY",
    "FIRECRAWL_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "AXIOM_TOKEN",
    "SLACK_BOT_TOKEN",
    "SLACK_ALERT_CHANNEL",
  ];
  const lines = keys.map((k) => `  ${String(k)}=${redact(String(k), env[k] as string | undefined)}`);
  console.log(`[${tag}] resolved env:\n${lines.join("\n")}`);
}
