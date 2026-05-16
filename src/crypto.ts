import { randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { CryptoIdentity } from "./types.js";
import { readJson, writeJson } from "./storage.js";

const keyFile = "crypto_identity.json";

export interface EncryptedPayload {
  version: 1;
  nonce: string;
  senderPublicKey: string;
  ciphertext: string;
}

export function generateKeypair(): CryptoIdentity {
  const pair = nacl.box.keyPair();
  return {
    publicKey: Buffer.from(pair.publicKey).toString("base64"),
    secretKey: Buffer.from(pair.secretKey).toString("base64"),
  };
}

export async function loadOrCreateKeypair(): Promise<CryptoIdentity> {
  const existing = await readJson<CryptoIdentity | null>(keyFile, null);
  if (existing?.publicKey && existing.secretKey) {
    return existing;
  }

  const keypair = generateKeypair();
  await writeJson(keyFile, keypair);
  return keypair;
}

export function encryptJson(
  value: unknown,
  recipientPublicKey: string,
  senderSecretKey: string,
  senderPublicKey: string,
): EncryptedPayload {
  const nonce = randomBytes(nacl.box.nonceLength);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = nacl.box(
    plaintext,
    nonce,
    Buffer.from(recipientPublicKey, "base64"),
    Buffer.from(senderSecretKey, "base64"),
  );

  if (!ciphertext) {
    throw new Error("Failed to encrypt payload");
  }

  return {
    version: 1,
    nonce: Buffer.from(nonce).toString("base64"),
    senderPublicKey,
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

export function decryptJson<T>(
  payload: EncryptedPayload,
  recipientSecretKey: string,
  senderPublicKey = payload.senderPublicKey,
): T {
  const plaintext = nacl.box.open(
    Buffer.from(payload.ciphertext, "base64"),
    Buffer.from(payload.nonce, "base64"),
    Buffer.from(senderPublicKey, "base64"),
    Buffer.from(recipientSecretKey, "base64"),
  );

  if (!plaintext) {
    throw new Error("Unable to decrypt payload with provided keypair");
  }

  return JSON.parse(Buffer.from(plaintext).toString("utf8")) as T;
}

export function encodeEncryptedBody(payload: EncryptedPayload): string {
  return [
    "GBRAIN-ENCRYPTED-PAYLOAD v1",
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  ].join("\n");
}

export function decodeEncryptedBody(body: string): EncryptedPayload | null {
  const [header, encoded] = body.trim().split(/\n/, 2);
  if (header !== "GBRAIN-ENCRYPTED-PAYLOAD v1" || !encoded) {
    return null;
  }

  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as EncryptedPayload;
}
