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
    await new Promise<void>((resolve) => {
      this.server = app.listen(port, () => resolve());
    });
    const address = this.server.address();
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
        references?: string[] | string;
      };
      body_text?: string;
      bodyText?: string;
      text?: string;
    };
  };

  const email = value.email;
  if (!email?.headers) {
    return null;
  }

  const references = email.headers.references;
  return {
    id: email.id ?? value.id,
    messageId: email.headers.message_id ?? email.headers.messageId,
    from: email.headers.from ?? "",
    to: email.headers.to ?? "",
    subject: email.headers.subject ?? "",
    bodyText: email.body_text ?? email.bodyText ?? email.text ?? "",
    inReplyTo: email.headers.in_reply_to,
    references: Array.isArray(references) ? references : references?.split(/\s+/),
  };
}
