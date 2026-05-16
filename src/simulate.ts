import { randomBytes } from "node:crypto";
import Bonjour from "bonjour-service";
import demoProfiles from "./fixtures/demo_profiles.json" with { type: "json" };
import { generateKeypair } from "./crypto.js";
import { generatePseudonym } from "./identity.js";
import { createLogger } from "./logger.js";

export interface SimulatedAgent {
  pseudonym: string;
  primitiveEmail: string;
  stop: () => void;
}

export async function startSimulation(count: number, options: { logs?: boolean; silent?: boolean } = {}): Promise<SimulatedAgent[]> {
  const logger = createLogger(options);
  const agents: SimulatedAgent[] = [];

  for (let index = 0; index < count; index += 1) {
    const bonjour = new Bonjour();
    const profile = demoProfiles[index % demoProfiles.length];
    const keypair = generateKeypair();
    const pseudonym = generatePseudonym();
    const primitiveEmail = `${profile.slug}-${randomBytes(1).toString("hex")}@demo.primitive.example`;
    const port = 41_000 + index;

    bonjour.publish({
      name: `gbrain-sim-${pseudonym.replace("#", "")}`,
      type: "gbrain",
      protocol: "tcp",
      port,
      txt: {
        pseudonym,
        primitiveEmail,
        publicKey: keypair.publicKey,
        version: "1",
        simulated: "true",
      },
    });

    logger.info(`Simulated ${pseudonym} (${profile.title}) on _gbrain._tcp`);
    agents.push({
      pseudonym,
      primitiveEmail,
      stop: () => {
        bonjour.unpublishAll();
        bonjour.destroy();
      },
    });
  }

  return agents;
}
