const port = process.env.OPSTAGE_PORT ?? "8080";
const host = process.env.OPSTAGE_HEALTHCHECK_HOST ?? "127.0.0.1";
const url = `http://${host}:${port}/api/system/health`;

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  if (!response.ok || body?.data?.status !== "UP") {
    console.error(`unhealthy: ${response.status}`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
