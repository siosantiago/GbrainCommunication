import { EventEmitter } from "node:events";
import express from "express";
import {
  handleWebhook,
  isEmailReceivedEvent,
  normalizeReceivedEmail,
  parseWebhookEvent,
  PrimitiveWebhookError,
  ReceivedEmail,
} from "@primitivedotdev/sdk";
import { AgentConfig } from "./types.js";
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
        const email = this.parseInbound(req.body, req.headers);
        if (email) {
          this.emit("email", email);
          this.logger.debug(
            `Inbound Primitive email from ${email.sender.address}: ${email.subject ?? "(no subject)"}`,
          );
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

  private parseInbound(body: Buffer, headers: express.Request["headers"]): ReceivedEmail | null {
    if (this.config.primitiveWebhookSecret) {
      const event = handleWebhook({
        body,
        headers,
        secret: this.config.primitiveWebhookSecret,
      });
      return normalizeReceivedEmail(event);
    }

    const raw = JSON.parse(body.toString("utf8"));
    const event = parseWebhookEvent(raw);
    if (!isEmailReceivedEvent(event)) {
      return null;
    }
    return normalizeReceivedEmail(event);
  }
}
