// Encryption for API keys at rest (owner pool keys and users' own Gemini keys). AES-256-GCM.
// The master secret comes from APP_SECRET; in development one is generated once into the data directory.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let masterKey: Buffer | null = null;

function master(): Buffer {
  if (masterKey) return masterKey;
  let secret = process.env.APP_SECRET || "";
  if (!secret) {
    if (config.isProd) throw new Error("APP_SECRET must be set in production to store API keys.");
    const file = path.join(config.dataDir, ".app-secret");
    try {
      secret = fs.readFileSync(file, "utf8").trim();
    } catch {
      secret = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  masterKey = crypto.createHash("sha256").update(secret).digest();
  return masterKey;
}

/** Tests use a fixed secret so they never touch the filesystem. */
export function _setMasterSecret(secret: string) {
  masterKey = crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", master(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export const last4 = (key: string) => key.trim().slice(-4);
