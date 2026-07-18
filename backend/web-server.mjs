#!/usr/bin/env node
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const root = process.env.INSTALL_ROOT || "/opt/autoscript";
const port = Number(process.env.PORT || process.env.WEB_INTERNAL_PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const candidates = [
  `${root}/dist/server/index.mjs`,
  `${root}/.output/server/index.mjs`,
];
const entryPath = candidates.find((path) => existsSync(path));

if (!entryPath) {
  console.error("Autoscript web bundle not found. Run: autoscript update");
  process.exit(1);
}

const mod = await import(pathToFileURL(entryPath).href);
const handler = mod.default?.fetch ? mod.default : mod.default ?? mod;

// Nitro's real node-server preset starts its own HTTP server as a side-effect
// and exports `{}`. In that case this launcher only needs to import it.
if (typeof handler.fetch !== "function" && entryPath.includes("/.output/")) {
  console.log(`Autoscript web server started using ${entryPath}`);
}
else {
const executionContext = {
  waitUntil(promise) {
    Promise.resolve(promise).catch((error) => console.error(error));
  },
  passThroughOnException() {},
};

if (typeof handler.fetch !== "function") {
  console.error(`Autoscript web bundle has no fetch handler: ${entryPath}`);
  process.exit(1);
}

function requestUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `${host}:${port}`;
  return `${proto}://${hostHeader}${req.url || "/"}`;
}

function requestBody(req) {
  if (["GET", "HEAD"].includes(req.method || "GET")) return undefined;
  return Readable.toWeb(req);
}

createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value != null) headers.set(key, value);
    }

    const request = new Request(requestUrl(req), {
      method: req.method,
      headers,
      body: requestBody(req),
      duplex: "half",
    });

    const response = await handler.fetch(request, process.env, executionContext);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Autoscript web server error\n");
  }
}).listen(port, host, () => {
  console.log(`Autoscript web server listening on http://${host}:${port} using ${entryPath}`);
});
}