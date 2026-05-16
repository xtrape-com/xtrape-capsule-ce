import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return value;
}, z.boolean());

const envSchema = z.object({
  OPSTAGE_HOST: z.string().default("0.0.0.0"),
  OPSTAGE_PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().default("file:./data/opstage.db"),
  OPSTAGE_ADMIN_USERNAME: z.string().min(1).optional(),
  OPSTAGE_ADMIN_PASSWORD: z.string().min(12).optional(),
  OPSTAGE_SESSION_SECRET: z
    .string({ required_error: "OPSTAGE_SESSION_SECRET is required (>=32 chars)" })
    .min(32, "OPSTAGE_SESSION_SECRET must be at least 32 chars"),
  OPSTAGE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28800),
  OPSTAGE_STATIC_DIR: z.string().default("apps/opstage-ui/dist"),
  OPSTAGE_AGENT_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(90),
  OPSTAGE_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
  OPSTAGE_MAINTENANCE_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
  OPSTAGE_BACKUP_DIR: z.string().default("./data/backups"),
  OPSTAGE_COMMAND_RESULT_MAX_BYTES: z.coerce.number().int().positive().default(1_000_000),
  OPSTAGE_CAPSULE_BUS_ENABLED: booleanFromEnv.default(false),
  NODE_ENV: z.string().optional(),
  // Image / build metadata. Populated at container build time by the
  // docker-publish workflow via --build-arg; harmless if unset locally.
  OPSTAGE_VERSION: z.string().optional(),
  OPSTAGE_COMMIT: z.string().optional(),
  OPSTAGE_BUILD_TIME: z.string().optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
}
