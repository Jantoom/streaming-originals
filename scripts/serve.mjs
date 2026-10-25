#!/usr/bin/env node
// Serves ./dist locally so you can install http://127.0.0.1:7000/manifest.json in
// Stremio on this machine before deploying. Mimics a static host: CORS on, path decoded.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT) || 7000;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  res.setHeader("access-control-allow-origin", "*");
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": file.endsWith(".json") ? "application/json" : "text/html; charset=utf-8" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "application/json" }).end('{"metas":[]}');
  }
  console.log(res.statusCode, path);
}).listen(port, () => console.log(`Serving dist on http://127.0.0.1:${port}/manifest.json`));
