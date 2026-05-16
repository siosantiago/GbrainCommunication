import { createHash } from "node:crypto";
import {
  createPrimitiveClient,
  PrimitiveApiError,
  ReceivedEmail,
  SendResult,
} from "@primitivedotdev/sdk";
import { AgentConfig, PrimitiveMessage } from "./types.js";
import { AgentLogger } from "./logger.js";

export type SendOutcome = SendResult | { id: string; deliveryStatus: "dry_run" };

export interface SendMailInput {
  to: string;
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  wait?: boolean;
  fromDisplayName?: string;
}

export interface ReplyMailInput {
  inbound: ReceivedEmail;
  bodyText: string;
  wait?: boolean;
  fromDisplayName?: string;
}

export class PrimitiveTransport {
  private readonly client;

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
  ) {
    this.client = createPrimitiveClient({ apiKey: config.primitiveApiKey });
  }

  async send(input: SendMailInput): Promise<SendOutcome> {
    const idempotencyKey = createHash("sha256")
      .update(`${this.config.primitiveFrom}:${input.to}:${input.subject}:${input.bodyText}`)
      .digest("hex");

    if (this.isDryRun()) {
      this.logger.debug(`Dry-run Primitive send to ${input.to}: ${input.subject}`);
      return { id: idempotencyKey.slice(0, 16), deliveryStatus: "dry_run" };
    }

    try {
      const result = await this.client.send(
        {
          from: this.formatFrom(input.fromDisplayName),
          to: input.to,
          subject: input.subject,
          bodyText: input.bodyText,
          thread: input.inReplyTo
            ? {
                inReplyTo: input.inReplyTo,
                references: input.references,
              }
            : undefined,
          wait: input.wait ?? true,
          waitTimeoutMs: 10_000,
        },
        { idempotencyKey },
      );

      this.logDelivery(input.to, "send", result);
      return result;
    } catch (error) {
      throw wrapPrimitiveError(error);
    }
  }

  async reply(input: ReplyMailInput): Promise<SendOutcome> {
    const idempotencyKey = createHash("sha256")
      .update(`reply:${input.inbound.id}:${input.bodyText}`)
      .digest("hex");

    if (this.isDryRun()) {
      this.logger.debug(`Dry-run Primitive reply on ${input.inbound.id}`);
      return { id: idempotencyKey.slice(0, 16), deliveryStatus: "dry_run" };
    }

    try {
      const result = await this.client.reply(
        input.inbound,
        {
          text: input.bodyText,
          from: this.formatFrom(input.fromDisplayName),
          wait: input.wait ?? true,
        },
        { idempotencyKey },
      );

      this.logDelivery(input.inbound.sender.address, "reply", result);
      return result;
    } catch (error) {
      throw wrapPrimitiveError(error);
    }
  }

  async sendAgentMessage(
    peerEmail: string,
    message: PrimitiveMessage,
    fromDisplayName?: string,
  ): Promise<SendOutcome> {
    return this.send({
      to: peerEmail,
      subject: message.subject,
      bodyText: message.bodyText,
      inReplyTo: message.inReplyTo,
      references: message.references,
      wait: true,
      fromDisplayName,
    });
  }

  isDryRun(): boolean {
    return (
      !this.config.primitiveApiKey ||
      this.config.primitiveApiKey.startsWith("demo_") ||
      this.config.primitiveApiKey === "prim_demo" ||
      this.config.primitiveFrom.endsWith(".example")
    );
  }

  private formatFrom(displayName?: string): string {
    if (!displayName) {
      return this.config.primitiveFrom;
    }
    const escaped = displayName.replace(/"/g, "");
    return `"GBrain ${escaped}" <${this.config.primitiveFrom}>`;
  }

  private logDelivery(target: string, kind: "send" | "reply", result: SendResult): void {
    const status = result.deliveryStatus ?? result.status;
    if (status === "bounced") {
      this.logger.error(
        `Primitive ${kind} to ${target} bounced${result.smtpResponseText ? `: ${result.smtpResponseText}` : ""}`,
      );
      return;
    }
    if (status === "deferred") {
      this.logger.info(`Primitive ${kind} to ${target} deferred (will retry server-side)`);
      return;
    }
    if (status === "wait_timeout") {
      this.logger.debug(`Primitive ${kind} to ${target} wait_timeout (outcome unknown)`);
      return;
    }
    this.logger.debug(`Primitive ${kind} to ${target}: ${status}`);
  }
}

function wrapPrimitiveError(error: unknown): Error {
  if (error instanceof PrimitiveApiError) {
    const gate = error.gates?.map((item) => `${item.name}:${item.reason}`).join(", ");
    return new Error(
      `Primitive send failed (${error.code ?? error.status}): ${error.message}${gate ? ` [${gate}]` : ""}`,
    );
  }
  return error as Error;
}
