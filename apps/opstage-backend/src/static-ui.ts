import { stat } from "node:fs/promises";
import path from "node:path";

const staticMimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

export function staticContentType(filePath: string): string {
  return staticMimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export async function resolveStaticFile(staticDir: string, urlPath: string): Promise<string | null> {
  const root = path.resolve(staticDir);
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const candidate = path.resolve(root, `.${normalized}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return null;
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
  } catch {
    // Fall through to SPA index fallback.
  }
  const indexFile = path.resolve(root, "index.html");
  try {
    const info = await stat(indexFile);
    return info.isFile() ? indexFile : null;
  } catch {
    return null;
  }
}
