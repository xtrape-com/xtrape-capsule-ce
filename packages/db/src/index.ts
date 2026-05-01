import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_WORKSPACE = {
  id: "wks_default",
  code: "default",
  name: "Default Workspace",
  status: "ACTIVE"
} as const;

export const prismaSchemaPath = "packages/db/schema.prisma";

export type Db = Database.Database;

export interface OpenDatabaseOptions {
  databaseUrl?: string;
}

export function databaseUrlToPath(databaseUrl: string): string {
  if (databaseUrl === ":memory:") return databaseUrl;
  if (databaseUrl.startsWith("file:")) return databaseUrl.slice("file:".length);
  return databaseUrl;
}

export function openDatabase(options: OpenDatabaseOptions = {}): Db {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/opstage.db";
  const dbPath = databaseUrlToPath(databaseUrl);
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

export function migrateDatabase(db: Db): void {
  db.exec(`
    create table if not exists workspaces (
      id text primary key,
      code text not null unique,
      name text not null,
      status text not null default 'ACTIVE',
      createdAt text not null,
      updatedAt text not null
    );

    create table if not exists users (
      id text primary key,
      workspaceId text not null,
      username text not null unique,
      passwordHash text not null,
      displayName text,
      role text not null default 'owner',
      status text not null default 'ACTIVE',
      lastLoginAt text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(workspaceId) references workspaces(id)
    );

    create table if not exists audit_events (
      id text primary key,
      workspaceId text not null,
      actorType text not null,
      actorId text,
      action text not null,
      targetType text,
      targetId text,
      result text not null,
      message text,
      ipAddress text,
      userAgent text,
      metadataJson text,
      createdAt text not null,
      foreign key(workspaceId) references workspaces(id)
    );

    create table if not exists system_settings (
      id text primary key,
      workspaceId text,
      key text not null,
      valueJson text not null,
      createdAt text not null,
      updatedAt text not null,
      foreign key(workspaceId) references workspaces(id),
      unique(workspaceId, key)
    );

    create index if not exists idx_users_workspace on users(workspaceId);
    create index if not exists idx_audit_workspace_created on audit_events(workspaceId, createdAt);
    create index if not exists idx_audit_actor on audit_events(actorType, actorId);
    create index if not exists idx_audit_target on audit_events(targetType, targetId);

    create table if not exists registration_tokens (
      id text primary key,
      workspaceId text not null,
      name text not null,
      tokenHash text not null unique,
      status text not null default 'ACTIVE',
      agentId text,
      expiresAt text,
      usedAt text,
      revokedAt text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(workspaceId) references workspaces(id)
    );

    create table if not exists agents (
      id text primary key,
      workspaceId text not null,
      code text not null,
      name text,
      mode text not null default 'embedded',
      runtime text,
      status text not null default 'PENDING',
      lastHeartbeatAt text,
      disabledAt text,
      revokedAt text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(workspaceId) references workspaces(id),
      unique(workspaceId, code)
    );

    create table if not exists agent_tokens (
      id text primary key,
      agentId text not null,
      tokenHash text not null unique,
      name text,
      status text not null default 'ACTIVE',
      lastUsedAt text,
      revokedAt text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(agentId) references agents(id)
    );

    create table if not exists capsule_services (
      id text primary key,
      workspaceId text not null,
      agentId text not null,
      code text not null,
      name text not null,
      description text,
      version text,
      runtime text,
      status text not null default 'UNKNOWN',
      healthStatus text not null default 'UNKNOWN',
      manifestJson text not null,
      lastReportedAt text,
      lastHealthAt text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(workspaceId) references workspaces(id),
      foreign key(agentId) references agents(id),
      unique(workspaceId, code)
    );

    create table if not exists health_reports (
      id text primary key,
      workspaceId text not null,
      serviceId text not null,
      agentId text not null,
      status text not null,
      message text,
      detailsJson text,
      reportedAt text not null,
      createdAt text not null,
      foreign key(serviceId) references capsule_services(id),
      foreign key(agentId) references agents(id)
    );

    create table if not exists config_items (
      id text primary key,
      workspaceId text not null,
      serviceId text not null,
      configKey text not null,
      label text,
      type text not null,
      source text,
      editable integer not null default 0,
      sensitive integer not null default 0,
      valuePreview text,
      defaultValue text,
      secretRef text,
      metadataJson text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(serviceId) references capsule_services(id),
      unique(serviceId, configKey)
    );

    create table if not exists action_definitions (
      id text primary key,
      workspaceId text not null,
      serviceId text not null,
      name text not null,
      label text not null,
      description text,
      dangerLevel text not null default 'LOW',
      requiresConfirmation integer not null default 0,
      inputSchemaJson text,
      timeoutSeconds integer,
      enabled integer not null default 1,
      metadataJson text,
      createdAt text not null,
      updatedAt text not null,
      foreign key(serviceId) references capsule_services(id),
      unique(serviceId, name)
    );

    create index if not exists idx_registration_tokens_workspace_status on registration_tokens(workspaceId, status);
    create index if not exists idx_agents_workspace_status on agents(workspaceId, status);
    create index if not exists idx_agent_tokens_agent_status on agent_tokens(agentId, status);
    create index if not exists idx_capsule_services_workspace_status on capsule_services(workspaceId, status);
    create index if not exists idx_capsule_services_agent on capsule_services(agentId);
    create index if not exists idx_health_reports_service_reported on health_reports(serviceId, reportedAt);
    create index if not exists idx_config_items_workspace on config_items(workspaceId);
    create index if not exists idx_action_definitions_workspace on action_definitions(workspaceId);


    create table if not exists commands (
      id text primary key,
      workspaceId text not null,
      agentId text not null,
      serviceId text not null,
      type text not null default 'ACTION',
      actionName text not null,
      status text not null default 'PENDING',
      payloadJson text,
      createdByUserId text,
      errorCode text,
      errorMessage text,
      createdAt text not null,
      updatedAt text not null,
      startedAt text,
      completedAt text,
      expiresAt text,
      foreign key(workspaceId) references workspaces(id),
      foreign key(agentId) references agents(id),
      foreign key(serviceId) references capsule_services(id),
      foreign key(createdByUserId) references users(id)
    );

    create table if not exists command_results (
      id text primary key,
      commandId text not null unique,
      agentId text not null,
      success integer not null,
      message text,
      dataJson text,
      errorJson text,
      reportedAt text not null,
      createdAt text not null,
      foreign key(commandId) references commands(id),
      foreign key(agentId) references agents(id)
    );

    create index if not exists idx_commands_workspace_status on commands(workspaceId, status);
    create index if not exists idx_commands_agent_status on commands(agentId, status);
    create index if not exists idx_commands_service_created on commands(serviceId, createdAt);
    create index if not exists idx_command_results_agent_reported on command_results(agentId, reportedAt);
  `);
}

export function ensureDefaultWorkspace(db: Db, now = new Date().toISOString()): typeof DEFAULT_WORKSPACE {
  db.prepare(`
    insert into workspaces (id, code, name, status, createdAt, updatedAt)
    values (@id, @code, @name, @status, @createdAt, @updatedAt)
    on conflict(id) do nothing
  `).run({ ...DEFAULT_WORKSPACE, createdAt: now, updatedAt: now });
  return DEFAULT_WORKSPACE;
}
