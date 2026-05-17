import { EventEmitter } from "node:events";
import chalk from "chalk";
import { LogLevel } from "./types.js";

export type AgentEvent =
  | "peer:discovered"
  | "profile:sent"
  | "match:scored"
  | "sandbox:started"
  | "sandbox:round"
  | "sandbox:complete"
  | "match:ready"
  | "trust:updated"
  | "debug"
  | "info"
  | "error";

export interface LogEvent {
  type: AgentEvent;
  message: string;
  meta?: Record<string, unknown>;
}

export class AgentLogger extends EventEmitter {
  constructor(private readonly level: LogLevel = "default") {
    super();
  }

  emitEvent(type: AgentEvent, message: string, meta?: Record<string, unknown>): void {
    const event: LogEvent = { type, message, meta };
    // "error" is reserved by Node.js EventEmitter — emit under a safe alias
    this.emit(type === "error" ? "agent:error" : type, event);
    this.emit("event", event);
    this.print(event);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level === "verbose") {
      this.emitEvent("debug", message, meta);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.emitEvent("info", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.emitEvent("error", message, meta);
  }

  private print(event: LogEvent): void {
    if (this.level === "silent") {
      return;
    }
    if (event.type === "debug" && this.level !== "verbose") {
      return;
    }

    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const prefix = chalk.dim(timestamp);

    if (event.type === "error") {
      console.error(`${prefix} ${chalk.red("✗")} ${event.message}`);
      return;
    }
    if (event.type === "debug") {
      console.log(`${prefix} ${chalk.dim("[debug]")} ${event.message}`);
      return;
    }
    if (event.type.includes("complete") || event.type === "match:ready") {
      console.log(`${prefix} ${chalk.green("✓")} ${event.message}`);
      return;
    }
    if (event.type.includes("round") || event.type.includes("started")) {
      console.log(`${prefix} ${chalk.cyan("⟳")} ${event.message}`);
      return;
    }
    console.log(`${prefix} ${chalk.green("●")} ${event.message}`);
  }
}

export function createLogger(options: { silent?: boolean; logs?: boolean } = {}): AgentLogger {
  if (options.silent) {
    return new AgentLogger("silent");
  }
  if (options.logs) {
    return new AgentLogger("verbose");
  }
  return new AgentLogger("default");
}
