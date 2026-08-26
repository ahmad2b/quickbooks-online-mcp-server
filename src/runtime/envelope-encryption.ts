import crypto from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class EnvelopeEncryption {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) {
      throw new Error("MCP_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
  }

  encrypt(plaintext: string, context: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  decrypt(envelope: string, context: string): string {
    const [version, ivValue, tagValue, encryptedValue, extra] = envelope.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra !== undefined) {
      throw new Error("Encrypted credential envelope is invalid");
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
