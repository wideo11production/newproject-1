import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { Buffer } from "buffer";

export function generateRandomBytes(length: number): Buffer {
  return randomBytes(length);
}

export function generateRandomString(length: number, charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      result += charset[byte % charset.length];
    }
  }
  return result;
}

export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString("base64url");
}

export function generateApiKey(prefix = "w11"): string {
  const timestamp = Date.now().toString(36);
  const random = generateRandomString(16);
  return `${prefix}_${timestamp}_${random}`;
}

export function hashString(str: string, algorithm = "sha256"): string {
  return createHash(algorithm).update(str).digest("hex");
}

export function hmacSign(data: string, secret: string, algorithm = "sha256"): string {
  return createHmac(algorithm, secret).update(data).digest("hex");
}

export function hmacVerify(data: string, secret: string, signature: string, algorithm = "sha256"): boolean {
  const expected = hmacSign(data, secret, algorithm);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const privateKey = generateRandomBytes(32);
  const publicKey = generateRandomBytes(65);
  return {
    privateKey: privateKey.toString("base64url"),
    publicKey: publicKey.toString("base64url"),
  };
}

export function base64UrlEncode(str: string): string {
  return Buffer.from(str).toString("base64url");
}

export function base64UrlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString();
}

export function generateJwtSecret(length = 64): string {
  return randomBytes(length).toString("base64url");
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

export function generateIv(): string {
  return randomBytes(12).toString("base64");
}

export function encryptData(data: string, key: string, iv: string): string {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64"));
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]).toString("base64");
}

export function decryptData(encryptedData: string, key: string, iv: string): string {
  const combined = Buffer.from(encryptedData, "base64");
  const authTag = combined.slice(-16);
  const encrypted = combined.slice(0, -16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || generateRandomString(16);
  const hash = createHash("sha256").update(password + actualSalt).digest("hex");
  return { hash, salt: actualSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const { hash: computedHash } = hashPassword(password, salt);
  return constantTimeCompare(computedHash, hash);
}