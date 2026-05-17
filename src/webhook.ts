import { EventEmitter } from "node:events";
import express from "express";
import { handleWebhook, PrimitiveWebhookError } from "@primitivedotdev/sdk";
import { AgentConfig, PrimitiveMessage } from "./types.js";
import { AgentLogger } from "./logger.js";

export class PrimitiveWebhookServer extends EventEmitter {
  private server?: ReturnType<express.Express["listen"]>;

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger,
  ) {
    super();
  }

  async start(): Promise<number> {
    const app = express();
    app.use(express.raw({ type: "application/json" }));

    app.post("/webhooks/email", (req, res) => {
      try {
        const event = this.config.primitiveWebhookSecret
          ? handleWebhook({
              body: req.body,
              headers: req.headers,
              secret: this.config.primitiveWebhookSecret,
            })
          : JSON.parse(req.body.toString("utf8"));

        const message = extractMessage(event);
        if (message) {
          this.emit("message", message);
          this.logger.debug(`Inbound Primitive message from ${message.from}: ${message.subject}`);
        }

        res.status(200).json({ received: true });
      } catch (error) {
        if (error instanceof PrimitiveWebhookError) {
          this.logger.error(`Primitive webhook verification failed: ${error.code}`);
          res.status(400).json({ error: error.code });
          return;
        }
        this.logger.error(`Primitive webhook error: ${(error as Error).message}`);
        res.status(500).json({ error: "webhook_error" });
      }
    });

    const port = this.config.webhookPort ?? 0;
    const server = await new Promise<NonNullable<typeof this.server>>((resolve) => {
      const listening = app.listen(port, () => resolve(listening));
    });
    this.server = server;
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    this.logger.debug(`Primitive webhook listening on :${actualPort}/webhooks/email`);
    return actualPort;
  }

  stop(): void {
    this.server?.close();
  }
}

function extractMessage(event: unknown): PrimitiveMessage | null {
  const value = event as {
    id?: string;
    email?: {
      id?: string;
      headers?: {
        from?: string;
        to?: string;
        subject?: string;
        message_id?: string;
        messageId?: string;
        in_reply_to?: string;
        inReplyTo?: string;
        references?: string[] | string;
      };
      parsed?: {
        body_text?: string;
        in_reply_to?: string;
        references?: string[] | string;
      };
      body_text?: string;
      bodyText?: string;
      text?: string;
      from?: string;
      to?: string;
      subject?: string;
    };
  };

  const email = value.email;
  if (!email) {
    return null;
  }

  const from = email.headers?.from ?? email.from ?? "";
  const to = email.headers?.to ?? email.to ?? "";
  const subject = email.headers?.subject ?? email.subject ?? "";
  if (!from && !subject) {
    return null;
  }

  const rawReferences = email.headers?.references ?? email.parsed?.references;
  const rawInReplyTo = email.headers?.in_reply_to ?? email.headers?.inReplyTo ?? email.parsed?.in_reply_to;
  return {
    id: email.id ?? value.id,
    messageId: email.headers?.message_id ?? email.headers?.messageId,
    from,
    to,
    subject,
    bodyText: email.parsed?.body_text ?? email.body_text ?? email.bodyText ?? email.text ?? "",
    inReplyTo: rawInReplyTo,
    references: Array.isArray(rawReferences) ? rawReferences : rawReferences?.split(/\s+/),
  };
}
