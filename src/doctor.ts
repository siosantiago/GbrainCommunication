import { createServer } from "node:net";
import { access, constants } from "node:fs/promises";
import chalk from "chalk";
import { Bonjour } from "bonjour-service";
import { AgentConfig } from "./types.js";
import { GBrainClient } from "./gbrain.js";
import { createLogger } from "./logger.js";
import { ensureStateDir, statePath } from "./storage.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorOptions {
  config: AgentConfig;
  webhookPort?: number;
  skipNetwork?: boolean;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNodeVersion());
  checks.push(checkPrimitive(options.config));
  checks.push(checkGbrainKeyShape(options.config));
  checks.push(checkAnthropicKey(options.config));
  checks.push(await checkStateWritable());
  checks.push(await checkWebhookPort(options.webhookPort ?? options.config.webhookPort));

  if (!options.skipNetwork) {
    checks.push(await checkGbrainReachable(options.config));
    checks.push(await checkMdns());
  }

  return checks;
}

export function renderDoctorReport(checks: DoctorCheck[]): void {
  console.log(chalk.bold("\nGBrain Network Agent — preflight diagnostics\n"));
  for (const check of checks) {
    console.log(`  ${badge(check.status)} ${chalk.bold(check.name)} ${chalk.dim("—")} ${check.detail}`);
    if (check.hint && check.status !== "ok") {
      console.log(`     ${chalk.dim(`↳ ${check.hint}`)}`);
    }
  }

  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  console.log("");
  if (failures === 0 && warnings === 0) {
    console.log(`  ${chalk.green("✓")} All systems go — you can run ${chalk.bold("npx gbrain-agent start")}.`);
  } else if (failures === 0) {
    console.log(`  ${chalk.yellow("!")} ${warnings} warning(s). Demo will still run, but review hints above.`);
  } else {
    console.log(`  ${chalk.red("✗")} ${failures} failing check(s). Resolve before running the demo.`);
  }
  console.log("");
}

function badge(status: CheckStatus): string {
  if (status === "ok") return chalk.green("✓");
  if (status === "warn") return chalk.yellow("!");
  return chalk.red("✗");
}

function checkNodeVersion(): DoctorCheck {
  const raw = process.versions.node;
  const major = Number.parseInt(raw.split(".")[0] ?? "0", 10);
  if (major >= 20) {
    return { name: "Node.js runtime", status: "ok", detail: `v${raw} (>= 20 required)` };
  }
  return {
    name: "Node.js runtime",
    status: "fail",
    detail: `v${raw}`,
    hint: "Install Node.js 20+ — the agent uses native fetch and modern ESM.",
  };
}

function checkPrimitive(config: AgentConfig): DoctorCheck {
  const hasKey = Boolean(config.primitiveApiKey);
  const hasFrom = Boolean(config.primitiveFrom);
  const looksDemo =
    config.primitiveApiKey.startsWith("demo_") ||
    config.primitiveApiKey === "prim_demo" ||
    config.primitiveFrom.endsWith(".example");

  if (!hasKey || !hasFrom) {
    return {
      name: "Primitive email",
      status: "fail",
      detail: "Missing API key or sender address",
      hint: "Set PRIMITIVE_API_KEY and PRIMITIVE_FROM (verified sender).",
    };
  }
  if (looksDemo) {
    return {
      name: "Primitive email",
      status: "warn",
      detail: "Demo credentials detected — sends will be dry-run",
      hint: "Swap in a real PRIMITIVE_API_KEY + verified PRIMITIVE_FROM for live delivery.",
    };
  }
  return { name: "Primitive email", status: "ok", detail: `Sender ${config.primitiveFrom}` };
}

function checkGbrainKeyShape(config: AgentConfig): DoctorCheck {
  if (!config.gbrainApiKey) {
    return {
      name: "GBrain API key",
      status: "fail",
      detail: "Missing",
      hint: "Set GBRAIN_API_KEY (or paste during interactive setup).",
    };
  }
  if (config.gbrainApiKey.startsWith("demo_")) {
    return {
      name: "GBrain API key",
      status: "warn",
      detail: "Demo key — using built-in demo graph",
      hint: "Use a real GBRAIN_API_KEY to load your live collaboration graph.",
    };
  }
  return { name: "GBrain API key", status: "ok", detail: "Key configured" };
}

function checkAnthropicKey(config: AgentConfig): DoctorCheck {
  if (!config.anthropicApiKey) {
    return {
      name: "Anthropic key",
      status: "warn",
      detail: "Not set — match and sandbox will use deterministic local fallback",
      hint: "Set ANTHROPIC_API_KEY to enable Claude-powered match scoring and briefs.",
    };
  }
  if (config.anthropicApiKey.startsWith("demo_")) {
    return {
      name: "Anthropic key",
      status: "warn",
      detail: "Demo key — local fallback will be used",
      hint: "Replace with a real sk-ant-... key for full LLM-powered matching.",
    };
  }
  if (!config.anthropicApiKey.startsWith("sk-ant-")) {
    return {
      name: "Anthropic key",
      status: "warn",
      detail: "Key does not look like sk-ant-...",
      hint: "Double-check ANTHROPIC_API_KEY — agent will still attempt to use it.",
    };
  }
  return { name: "Anthropic key", status: "ok", detail: "sk-ant-... configured" };
}

async function checkStateWritable(): Promise<DoctorCheck> {
  try {
    await ensureStateDir();
    await access(statePath("."), constants.W_OK);
    return { name: "State directory", status: "ok", detail: `Writable at ${statePath(".")}` };
  } catch (error) {
    return {
      name: "State directory",
      status: "fail",
      detail: (error as Error).message,
      hint: "Run the agent from a directory where the user can create a state/ folder.",
    };
  }
}

async function checkWebhookPort(port?: number): Promise<DoctorCheck> {
  if (!port) {
    return {
      name: "Webhook port",
      status: "ok",
      detail: "Will bind ephemeral port",
    };
  }

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return {
      name: "Webhook port",
      status: "fail",
      detail: `Invalid port ${port}`,
      hint: "GBRAIN_WEBHOOK_PORT must be an integer between 0 and 65535.",
    };
  }

  return new Promise<DoctorCheck>((resolve) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve({
          name: "Webhook port",
          status: "fail",
          detail: `Port ${port} already in use`,
          hint: "Stop the conflicting process or pick a different GBRAIN_WEBHOOK_PORT.",
        });
      } else {
        resolve({
          name: "Webhook port",
          status: "warn",
          detail: `Could not test port ${port}: ${error.message}`,
        });
      }
    });
    try {
      server.listen({ port, host: "127.0.0.1" }, () => {
        server.close(() => {
          resolve({ name: "Webhook port", status: "ok", detail: `Port ${port} available` });
        });
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      resolve({
        name: "Webhook port",
        status: "fail",
        detail: `Could not bind port ${port}: ${err.message}`,
        hint:
          err.code === "ERR_SOCKET_BAD_PORT"
            ? "GBRAIN_WEBHOOK_PORT must be an integer between 0 and 65535."
            : "Check process permissions and port availability.",
      });
    }
  });
}

async function checkGbrainReachable(config: AgentConfig): Promise<DoctorCheck> {
  if (!config.gbrainApiKey || config.gbrainApiKey.startsWith("demo_")) {
    return {
      name: "GBrain API",
      status: "ok",
      detail: "Skipped (demo key in use)",
    };
  }
  const logger = createLogger({ silent: true });
  try {
    const ok = await new GBrainClient(config, logger).validate();
    if (ok) {
      return { name: "GBrain API", status: "ok", detail: "Profile endpoint reachable" };
    }
    return {
      name: "GBrain API",
      status: "warn",
      detail: "Profile endpoint not reachable — falling back to demo graph",
      hint: "Check GBRAIN_API_KEY and network connectivity to api.gbrain.dev.",
    };
  } catch (error) {
    return {
      name: "GBrain API",
      status: "warn",
      detail: (error as Error).message,
    };
  }
}

async function checkMdns(): Promise<DoctorCheck> {
  return new Promise<DoctorCheck>((resolve) => {
    let bonjour: Bonjour | undefined;
    const timeout = setTimeout(() => {
      try {
        bonjour?.unpublishAll();
        bonjour?.destroy();
      } catch {
        /* noop */
      }
      resolve({
        name: "mDNS / Bonjour",
        status: "ok",
        detail: "Multicast publish/browse initialized",
      });
    }, 800);

    try {
      bonjour = new Bonjour();
      bonjour.publish({
        name: `gbrain-doctor-${process.pid}`,
        type: "gbrain-doctor",
        protocol: "tcp",
        port: 0,
      });
    } catch (error) {
      clearTimeout(timeout);
      resolve({
        name: "mDNS / Bonjour",
        status: "warn",
        detail: `mDNS not available: ${(error as Error).message}`,
        hint: "On restricted networks/VMs mDNS may be blocked — use simulate mode and a shared host.",
      });
    }
  });
}

export function summarize(checks: DoctorCheck[]): { failures: number; warnings: number } {
  return {
    failures: checks.filter((check) => check.status === "fail").length,
    warnings: checks.filter((check) => check.status === "warn").length,
  };
}
