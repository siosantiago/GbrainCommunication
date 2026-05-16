import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Bonjour, Browser, Service } from "bonjour-service";
import { Identity, Peer } from "./types.js";
import { readJson, writeJson } from "./storage.js";
import { AgentLogger } from "./logger.js";

const peersFile = "peers.json";

export interface DiscoveryOptions {
  identity: Identity;
  primitiveEmail: string;
  publicKey: string;
  port: number;
  logger: AgentLogger;
}

export class DiscoveryService extends EventEmitter {
  private bonjour?: Bonjour;
  private browser?: Browser;

  constructor(private readonly options: DiscoveryOptions) {
    super();
  }

  async start(): Promise<void> {
    this.bonjour = new Bonjour();
    this.bonjour.publish({
      name: `gbrain-${this.options.identity.pseudonym.replace("#", "")}`,
      type: "gbrain",
      protocol: "tcp",
      port: this.options.port,
      txt: {
        pseudonym: this.options.identity.pseudonym,
        primitiveEmail: this.options.primitiveEmail,
        publicKey: this.options.publicKey,
        version: "1",
      },
    });

    const browser = this.bonjour.find({ type: "gbrain", protocol: "tcp" });
    this.browser = browser;
    browser.on("up", (service) => {
      void this.handleService(service).catch((error) => {
        this.options.logger.error(`Failed to process discovered service: ${(error as Error).message}`);
      });
    });

    this.options.logger.info(`Broadcasting _gbrain._tcp as ${this.options.identity.pseudonym}`);
  }

  stop(): void {
    this.browser?.stop();
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
  }

  private async handleService(service: Service): Promise<void> {
    const txt = normalizeTxt(service.txt ?? {});
    const pseudonym = txt.pseudonym;
    const primitiveEmail = txt.primitiveEmail;
    const publicKey = txt.publicKey;

    if (!pseudonym || !primitiveEmail || !publicKey) {
      this.options.logger.debug(`Ignoring incomplete _gbrain._tcp service ${service.name}`);
      return;
    }
    if (publicKey === this.options.publicKey || pseudonym === this.options.identity.pseudonym) {
      return;
    }

    const peer: Peer = {
      id: peerId(publicKey, primitiveEmail),
      pseudonym,
      primitiveEmail,
      publicKey,
      address: service.addresses?.find(Boolean),
      port: service.port,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      source: "mdns",
    };

    const peers = await readJson<Record<string, Peer>>(peersFile, {});
    const existing = peers[peer.id];
    peers[peer.id] = {
      ...peer,
      firstSeenAt: existing?.firstSeenAt ?? peer.firstSeenAt,
    };
    await writeJson(peersFile, peers);

    this.options.logger.emitEvent(
      "peer:discovered",
      `Discovered ${peer.pseudonym} ${peer.address ? `at ${peer.address}` : "nearby"}`,
      { peerId: peer.id },
    );
    this.emit("peer", peers[peer.id]);
  }
}

export function peerId(publicKey: string, primitiveEmail: string): string {
  return createHash("sha256").update(`${publicKey}:${primitiveEmail}`).digest("hex").slice(0, 16);
}

function normalizeTxt(txt: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(txt).map(([key, value]) => {
      if (Buffer.isBuffer(value)) {
        return [key, value.toString("utf8")];
      }
      return [key, String(value)];
    }),
  );
}
