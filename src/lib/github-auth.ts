import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set AUTH_SECRET to a random value of at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}

export function encryptGithubToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptGithubToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("Stored GitHub authorization is invalid. Connect GitHub again.");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export const githubCallbackUrl = () => `${(process.env.APP_URL ?? "http://localhost:3002").replace(/\/$/, "")}/api/auth/github/callback`;
export const githubTokenForUser = async (userId: number, stored: string | null | undefined) =>
  stored ? decryptGithubToken(stored) : process.env.GITHUB_TOKEN ?? null;
