import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "_site");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0]);
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

async function resolveFile(urlPath) {
  const candidate = safePath(urlPath);
  if (!candidate) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return path.join(candidate, "index.html");
    if (info.isFile()) return candidate;
  } catch {
    if (!path.extname(candidate)) {
      try {
        const indexFile = path.join(candidate, "index.html");
        if ((await stat(indexFile)).isFile()) return indexFile;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const server = http.createServer(async (request, response) => {
  const filePath = await resolveFile(request.url || "/");
  const servedPath = filePath ?? path.join(root, "404.html");
  response.statusCode = filePath ? 200 : 404;
  response.setHeader("Content-Type", mimeTypes[path.extname(servedPath)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(servedPath).pipe(response);
});

server.listen(port, host, () => {
  process.stdout.write(`미리보기: http://${host}:${port}/\n종료: Ctrl+C\n`);
});
