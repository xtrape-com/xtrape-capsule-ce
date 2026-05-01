import { createHash, randomBytes } from "node:crypto";
export type TokenPrefix = "opstage_reg_" | "opstage_agent_";
export function hashToken(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
export function newToken(prefix: TokenPrefix): { raw: string; hash: string } { const raw = `${prefix}${randomBytes(32).toString("base64url")}`; return { raw, hash: hashToken(raw) }; }
