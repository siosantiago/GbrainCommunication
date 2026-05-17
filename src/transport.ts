import { createHash } from "node:crypto";
import { createPrimitiveClient, PrimitiveApiError, SendResult } from "@primitivedotdev/sdk";
import { AgentConfig, PrimitiveMessage } from "./types.js";
import { AgentLogger } from "./logger.js";

export interface SendMailInput {
  to: string;
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  wait?: boolean;
}

export class PrimitiveTransport {
  private readonly client;

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
  ) {
    this.client = createPrimitiveClient({ apiKey: config.primitiveApiKey });
  }

  async send(input: SendMailInput): Promise<SendResult | { id: string; deliveryStatus: "dry_run" }> {
    const idempotencyKey = createHash("sha256")
      .update(`${this.config.primitiveFrom}:${input.to}:${input.subject}:${input.bodyText}`)
      .digest("hex");

    if (this.isDryRun() || input.to.endsWith(".example")) {
      this.logger.debug(`Dry-run Primitive send to ${input.to}: ${input.subject}`);
      return { id: idempotencyKey.slice(0, 16), deliveryStatus: "dry_run" };
    }

    try {
      const result = await this.client.send(
        {
          from: this.config.primitiveFrom,
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

      this.logger.debug(`Primitive delivery to ${input.to}: ${result.deliveryStatus ?? result.status}`);
      return result;
    } catch (error) {
      if (error instanceof PrimitiveApiError) {
        const gate = error.gates?.map((item) => `${item.name}:${item.reason}`).join(", ");
        throw new Error(`Primitive send failed (${error.code ?? error.status}): ${error.message}${gate ? ` [${gate}]` : ""}`);
      }
      throw error;
    }
  }

  async sendAgentMessage(peerEmail: string, message: PrimitiveMessage): Promise<void> {
    await this.send({
      to: peerEmail,
      subject: message.subject,
      bodyText: message.bodyText,
      inReplyTo: message.inReplyTo,
      references: message.references,
      wait: true,
    });
  }

  private isDryRun(): boolean {
    return (
      !this.config.primitiveApiKey ||
      this.config.primitiveApiKey.startsWith("demo_") ||
      this.config.primitiveApiKey === "prim_demo" ||
      this.config.primitiveFrom.endsWith(".example")
    );
  }
}
