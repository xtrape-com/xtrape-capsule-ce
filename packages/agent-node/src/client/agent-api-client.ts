
import type { AgentHeartbeatRequest, RegisterAgentRequest, RegisterAgentResponse, ReportCommandResultRequest, ServiceReportRequest, Command } from "@xtrape/capsule-contracts-node";
import { AgentApiError } from "./errors";
export class AgentApiClient {
  constructor(private readonly backendUrl: string) {}
  private url(path: string) { return new URL(path, this.backendUrl).toString(); }
  private async request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const headers = new Headers(init.headers); headers.set("content-type","application/json"); if (init.token) headers.set("authorization",`Bearer ${init.token}`);
    const res = await fetch(this.url(path), { ...init, headers }); const text = await res.text(); const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new AgentApiError(res.status, body?.error?.message ?? res.statusText, body);
    return (body?.data ?? body) as T;
  }
  register(req: RegisterAgentRequest) { return this.request<RegisterAgentResponse>("/api/agents/register", { method:"POST", body: JSON.stringify(req) }); }
  heartbeat(agentId: string, token: string, req: AgentHeartbeatRequest) { return this.request(`/api/agents/${agentId}/heartbeat`, { method:"POST", token, body: JSON.stringify(req) }); }
  reportServices(agentId: string, token: string, req: ServiceReportRequest) { return this.request(`/api/agents/${agentId}/services/report`, { method:"POST", token, body: JSON.stringify(req) }); }
  pollCommands(agentId: string, token: string) { return this.request<Command[]>(`/api/agents/${agentId}/commands`, { method:"GET", token }); }
  reportResult(agentId: string, token: string, commandId: string, req: ReportCommandResultRequest) { return this.request(`/api/agents/${agentId}/commands/${commandId}/result`, { method:"POST", token, body: JSON.stringify(req) }); }
}
