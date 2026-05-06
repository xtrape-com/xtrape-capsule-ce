
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenStore } from "../types";
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath = "./data/agent-token.json") {}
  async load(): Promise<string | null> { try { const parsed=JSON.parse(await readFile(this.filePath,"utf8")); if (typeof parsed.agentId === "string" && typeof parsed.agentToken === "string") return `${parsed.agentId}:${parsed.agentToken}`; return typeof parsed.agentToken === "string" ? parsed.agentToken : null; } catch (e: any) { if (e?.code === "ENOENT") return null; throw e; } }
  async save(token: string): Promise<void> { const [agentId, agentToken] = token.includes(":") ? token.split(":",2) : [undefined, token]; await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, JSON.stringify({ ...(agentId ? { agentId } : {}), agentToken, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 }); try { await chmod(this.filePath, 0o600); } catch {} }
  async clear(): Promise<void> { await rm(this.filePath, { force: true }); }
}
