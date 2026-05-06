
import type { ActionDefinitionInput, Command, ConfigItemInput, HealthReportInput, RegisterAgentResponse, ReportedService } from "@xtrape/capsule-contracts-node";
import { AgentApiClient } from "./client/agent-api-client";
import { AgentApiError } from "./client/errors";
import { FileTokenStore } from "./token-store/file-token-store";
import type { CapsuleAgentOptions, ConfigProvider, HealthProvider, RegisteredAction, TokenStore } from "./types";
import { redact } from "./security/redaction";
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class CapsuleAgent {
  private readonly client: AgentApiClient; private readonly store: TokenStore; private readonly logger; private agentId?: string; private token?: string; private stopped=true; private timers: NodeJS.Timeout[]=[]; private healthProvider: HealthProvider = () => ({ status: "UNKNOWN" }); private configProvider: ConfigProvider = () => []; private actions = new Map<string, RegisteredAction>();
  constructor(private readonly options: CapsuleAgentOptions) { this.client = new AgentApiClient(options.backendUrl); this.store = new FileTokenStore(options.tokenStore?.file); this.logger = options.logger ?? console; }
  health(provider: HealthProvider) { this.healthProvider = provider; return this; }
  configs(provider: ConfigProvider) { this.configProvider = provider; return this; }
  action(action: RegisteredAction) { this.actions.set(action.name, action); return this; }
  async start() { this.stopped=false; try { await this.ensureRegistered(); await this.reportService(); await this.heartbeat(); await this.pollOnce(); } catch(e) { this.log("error","agent start failed", e); if (this.options.failOnStartError) throw e; }
    if (this.options.autoStartLoops !== false) {
      this.loop("heartbeat", this.options.intervals?.heartbeatMs ?? (this.options.heartbeatIntervalSeconds ?? 30) * 1000, () => this.heartbeat());
      this.loop("service-report", this.options.intervals?.serviceReportMs ?? 60_000, () => this.reportService());
      this.loop("command-poll", this.options.intervals?.commandPollMs ?? (this.options.commandPollIntervalSeconds ?? 5) * 1000, () => this.pollOnce());
    }
  }
  async stop() { this.stopped=true; for (const t of this.timers) clearInterval(t); this.timers=[]; }
  private loop(name:string, ms:number, fn:()=>Promise<void>) { const t=setInterval(async()=>{ if(this.stopped) return; try { await fn(); } catch(e) { this.log("warn",`${name} failed`, e); } }, ms); this.timers.push(t); }
  private async ensureRegistered() { const stored = await this.store.load(); if (stored) { const [agentId, token] = stored.includes(":") ? stored.split(":",2) : [undefined, stored]; this.agentId=agentId; this.token=token; if (this.agentId) return; }
    if (!this.options.registrationToken) throw new Error("OPSTAGE registration token is required for first registration");
    const agent = this.options.agent ?? { code: this.options.service.code, name: this.options.service.name, runtime: this.options.service.runtime };
    const res = await this.retry(() => this.client.register({ registrationToken: this.options.registrationToken!, agent: { code: agent.code, name: agent.name, mode: "embedded", runtime: agent.runtime ?? "nodejs" }, service: this.serviceSnapshot() }));
    this.agentId=res.agentId; this.token=res.agentToken; await this.store.save(`${this.agentId}:${this.token}`); this.log("info",`registered agent ${this.agentId}`);
  }
  private serviceSnapshot(): ReportedService { const manifest = { kind:"CapsuleService", schemaVersion:"1.0", code:this.options.service.code, name:this.options.service.name, description:this.options.service.description, version:this.options.service.version, runtime:this.options.service.runtime, agentMode:"embedded", ...(this.options.service.manifest ?? {}) } as const; return { code:this.options.service.code, name:this.options.service.name, description:this.options.service.description, version:this.options.service.version, runtime:this.options.service.runtime, manifest, actions: [...this.actions.values()].map(({handler,prepare,inputSchema,outputSchema,...a})=>a as ActionDefinitionInput) }; }
  async runHealth(): Promise<HealthReportInput> { return this.healthProvider(); }
  private async reportService() { if(!this.agentId||!this.token) return; const [health, configs] = await Promise.all([this.runHealth(), this.configProvider()]); const svc={...this.serviceSnapshot(), health, configs: configs as ConfigItemInput[]}; await this.retry(()=>this.client.reportServices(this.agentId!, this.token!, { services:[svc] })); }
  private async heartbeat() { if(!this.agentId||!this.token) return; const health = await this.runHealth(); await this.retry(()=>this.client.heartbeat(this.agentId!, this.token!, { health })); }
  private async pollOnce() { if(!this.agentId||!this.token) return; const commands = await this.retry(()=>this.client.pollCommands(this.agentId!, this.token!)); for (const c of commands) await this.execute(c); }
  private async execute(command: Command) { const startedAt=new Date().toISOString(); const action=this.actions.get(command.actionName); if(!action){ await this.client.reportResult(this.agentId!, this.token!, command.id, { success:false, message:`No handler registered for action ${command.actionName}`, error:{ code:"ACTION_HANDLER_NOT_FOUND" }, startedAt, finishedAt:new Date().toISOString() }); return; }
    try {
      if (command.type === "ACTION_PREPARE") {
        const out = action.prepare ? await Promise.resolve(action.prepare()) : this.defaultPrepare(action);
        await this.client.reportResult(this.agentId!, this.token!, command.id, { success:true, data: out as Record<string, unknown>, startedAt, finishedAt:new Date().toISOString() });
        return;
      }
      const out = await this.withTimeout(Promise.resolve(action.handler(command.payload ?? {})), action.timeoutSeconds);
      const result = out as { success?: boolean; message?: string; data?: Record<string, unknown>; error?: Record<string, unknown> };
      const success = result.success !== false;
      await this.client.reportResult(this.agentId!, this.token!, command.id, { success, message: result.message, data: result.data ?? (success ? out as Record<string, unknown> : undefined), error: result.error, startedAt, finishedAt:new Date().toISOString() });
    }
    catch(e:any){ await this.client.reportResult(this.agentId!, this.token!, command.id, { success:false, message:e?.message ?? "Action failed", error:{ code:"ACTION_FAILED", message:e?.message ?? String(e) }, startedAt, finishedAt:new Date().toISOString() }); }
  }
  private defaultPrepare(action: RegisteredAction): Record<string, unknown> { const { handler:_handler, prepare:_prepare, ...meta } = action; return { action: meta as Record<string, unknown>, initialPayload: this.initialPayloadFromSchema(action.inputSchema), currentState: {} }; }
  private initialPayloadFromSchema(schema: unknown): Record<string, unknown> { const props = schema && typeof schema === "object" && !Array.isArray(schema) ? (schema as { properties?: unknown }).properties : undefined; if(!props || typeof props !== "object" || Array.isArray(props)) return {}; return Object.fromEntries(Object.entries(props as Record<string,{default?:unknown; type?: string|string[]}>).map(([k,m])=>{ if(m.default!==undefined) return [k,m.default]; if(m.type==="number"||m.type==="integer") return [k,0]; if(m.type==="boolean") return [k,false]; if(m.type==="array") return [k,[]]; if(m.type==="object") return [k,{}]; return [k,""]; })); }
  private async withTimeout<T>(p:Promise<T>, seconds?:number): Promise<T> { if(!seconds) return p; let t:any; const timeout=new Promise<never>((_,rej)=>{ t=setTimeout(()=>rej(new Error("Action timed out")), seconds*1000); }); try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); } }
  private async retry<T>(fn:()=>Promise<T>, attempts=5): Promise<T> { let last:any; for(let i=0;i<attempts;i++){ try { return await fn(); } catch(e:any){ last=e; if(e instanceof AgentApiError && e.status < 500) throw e; await sleep(Math.min(1000*2**i, 15000)); } } throw last; }
  private log(level:"debug"|"info"|"warn"|"error", msg:string, obj?:unknown){ this.logger[level](msg, obj ? redact(obj) : undefined); }
}
