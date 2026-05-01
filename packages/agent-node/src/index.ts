import type { ActionDefinitionInput, ConfigItemInput, HealthReportInput, ReportedService } from "@xtrape/capsule-contracts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FileTokenStoreOptions {
  file: string;
}

export interface CapsuleAgentOptions {
  backendUrl: string;
  registrationToken?: string;
  tokenStore?: FileTokenStoreOptions;
  service: Omit<ReportedService, "manifest" | "health" | "configs" | "actions"> & {
    manifest?: Record<string, unknown>;
  };
  heartbeatIntervalSeconds?: number;
  commandPollIntervalSeconds?: number;
  autoStartLoops?: boolean;
  fetchImpl?: typeof fetch;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export type ActionHandler = (payload: Record<string, unknown> | undefined) => Promise<ActionResult> | ActionResult;

export type RegisteredAction = Omit<ActionDefinitionInput, "dangerLevel" | "requiresConfirmation"> & {
  dangerLevel?: ActionDefinitionInput["dangerLevel"];
  requiresConfirmation?: boolean;
  handler: ActionHandler;
};

export interface AgentTokenState {
  agentId: string;
  agentToken: string;
}

interface CommandInput {
  id: string;
  actionName: string;
  payload?: Record<string, unknown>;
}

class FileTokenStore {
  constructor(private readonly file: string) {}

  async read(): Promise<AgentTokenState | undefined> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as AgentTokenState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(state: AgentTokenState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}

export class CapsuleAgent {
  private healthProvider?: () => Promise<HealthReportInput> | HealthReportInput;
  private configProvider?: () => Promise<ConfigItemInput[]> | ConfigItemInput[];
  private readonly actions = new Map<string, RegisteredAction>();
  private tokenState?: AgentTokenState;
  private heartbeatTimer?: NodeJS.Timeout;
  private commandPollTimer?: NodeJS.Timeout;
  private heartbeatIntervalSeconds: number;
  private commandPollIntervalSeconds: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CapsuleAgentOptions) {
    this.heartbeatIntervalSeconds = options.heartbeatIntervalSeconds ?? 30;
    this.commandPollIntervalSeconds = options.commandPollIntervalSeconds ?? 5;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  health(provider: () => Promise<HealthReportInput> | HealthReportInput): void {
    this.healthProvider = provider;
  }

  configs(provider: () => Promise<ConfigItemInput[]> | ConfigItemInput[]): void {
    this.configProvider = provider;
  }

  action(action: RegisteredAction): void {
    this.actions.set(action.name, action);
  }

  async buildServiceReport(): Promise<ReportedService> {
    const health = this.healthProvider ? await this.healthProvider() : undefined;
    const configs = this.configProvider ? await this.configProvider() : [];
    const actions = [...this.actions.values()].map(({ handler: _handler, ...definition }) => ({
      dangerLevel: "LOW" as const,
      requiresConfirmation: false,
      ...definition
    }));
    return {
      ...this.options.service,
      manifest: this.options.service.manifest ?? {
        kind: "CapsuleService",
        code: this.options.service.code,
        name: this.options.service.name,
        version: this.options.service.version,
        runtime: this.options.service.runtime
      },
      health,
      configs,
      actions
    };
  }

  async start(): Promise<void> {
    await this.ensureRegistered();
    await this.reportServices();
    await this.heartbeat();
    if (this.options.autoStartLoops !== false) {
      this.startLoops();
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.commandPollTimer) clearInterval(this.commandPollTimer);
  }

  async runHealth(): Promise<HealthReportInput> {
    return this.healthProvider ? await this.healthProvider() : { status: "UNKNOWN" };
  }

  async ensureRegistered(): Promise<AgentTokenState> {
    if (this.tokenState) return this.tokenState;
    const store = this.tokenStore();
    const stored = await store?.read();
    if (stored) {
      this.tokenState = stored;
      return stored;
    }
    if (!this.options.registrationToken) {
      throw new Error("Registration token is required when no stored Agent token exists.");
    }
    const response = await this.request<{ agentId: string; agentToken: string; heartbeatIntervalSeconds?: number; commandPollIntervalSeconds?: number }>("/api/agents/register", {
      method: "POST",
      body: {
        registrationToken: this.options.registrationToken,
        agent: {
          code: this.options.service.code,
          name: this.options.service.name,
          mode: "embedded",
          runtime: this.options.service.runtime
        },
        service: await this.buildServiceReport()
      }
    });
    this.heartbeatIntervalSeconds = response.heartbeatIntervalSeconds ?? this.heartbeatIntervalSeconds;
    this.commandPollIntervalSeconds = response.commandPollIntervalSeconds ?? this.commandPollIntervalSeconds;
    this.tokenState = { agentId: response.agentId, agentToken: response.agentToken };
    await store?.write(this.tokenState);
    return this.tokenState;
  }

  async reportServices(): Promise<void> {
    const token = await this.ensureRegistered();
    await this.request(`/api/agents/${token.agentId}/services/report`, {
      method: "POST",
      token: token.agentToken,
      body: { services: [await this.buildServiceReport()] }
    });
  }

  async heartbeat(): Promise<void> {
    const token = await this.ensureRegistered();
    const health = await this.runHealth();
    const response = await this.request<{ heartbeatIntervalSeconds?: number; commandPollIntervalSeconds?: number }>(`/api/agents/${token.agentId}/heartbeat`, {
      method: "POST",
      token: token.agentToken,
      body: { health }
    });
    this.heartbeatIntervalSeconds = response.heartbeatIntervalSeconds ?? this.heartbeatIntervalSeconds;
    this.commandPollIntervalSeconds = response.commandPollIntervalSeconds ?? this.commandPollIntervalSeconds;
  }

  async pollOnce(): Promise<CommandInput[]> {
    const token = await this.ensureRegistered();
    const commands = await this.request<CommandInput[]>(`/api/agents/${token.agentId}/commands`, {
      method: "GET",
      token: token.agentToken
    });
    for (const command of commands) {
      await this.dispatchCommand(command);
    }
    return commands;
  }

  async dispatchCommand(command: CommandInput): Promise<ActionResult> {
    const token = await this.ensureRegistered();
    const handler = this.actions.get(command.actionName)?.handler;
    let result: ActionResult;
    if (!handler) {
      result = { success: false, message: `No action handler registered for ${command.actionName}.`, error: { code: "ACTION_HANDLER_NOT_FOUND" } };
    } else {
      try {
        result = await handler(command.payload);
      } catch (error) {
        result = {
          success: false,
          message: error instanceof Error ? error.message : "Action handler failed.",
          error: { code: "ACTION_HANDLER_ERROR" }
        };
      }
    }
    await this.request(`/api/agents/${token.agentId}/commands/${command.id}/result`, {
      method: "POST",
      token: token.agentToken,
      body: result
    });
    return result;
  }

  private startLoops(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch(error => console.error("[capsule-agent] heartbeat failed", redactError(error)));
    }, this.heartbeatIntervalSeconds * 1000);
    this.heartbeatTimer.unref?.();

    this.commandPollTimer = setInterval(() => {
      void this.pollOnce().catch(error => console.error("[capsule-agent] command polling failed", redactError(error)));
    }, this.commandPollIntervalSeconds * 1000);
    this.commandPollTimer.unref?.();
  }

  private tokenStore(): FileTokenStore | undefined {
    return this.options.tokenStore?.file ? new FileTokenStore(this.options.tokenStore.file) : undefined;
  }

  private async request<T = unknown>(path: string, options: { method: "GET" | "POST"; token?: string; body?: unknown }): Promise<T> {
    const response = await this.fetchImpl(`${this.options.backendUrl.replace(/\/$/, "")}${path}`, {
      method: options.method,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as { success?: boolean; data?: T; error?: { code?: string; message?: string } } : {};
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error?.message ?? `Request failed: ${response.status}`);
    }
    return payload.data as T;
  }
}

function redactError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/opstage_(reg|agent)_[A-Za-z0-9_-]+/g, "[REDACTED]") : "Unknown error";
}

export type { ActionDefinitionInput, ConfigItemInput, HealthReportInput };
