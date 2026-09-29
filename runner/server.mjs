import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);
const headless = process.env.HEADLESS !== "0";

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

let browser;
let context;
let page;

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function startSession(difficulty = "normal") {
  if (!browser) browser = await chromium.launch({ headless });
  if (context) await context.close();
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`http://${host}:${port}/ai/agent.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BlackgateAI);
  await page.evaluate(level => window.BlackgateAI.setDifficulty(level), difficulty);
  return page.evaluate(() => window.BlackgateAI.act("start"));
}

async function ensureSession() {
  if (!page) return startSession("normal");
  return page;
}

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === "/") relative = "/ai/agent.html";
  const target = path.resolve(root, "." + relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, "index.html") : target;
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": mime.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      "content-length": data.length,
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || host}`);

    if (req.method === "OPTIONS") return json(res, 204, {});

    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, { ok: true, spec: "blackgate-ai/1" });
    }

    if (url.pathname === "/api/new" && req.method === "POST") {
      const body = await readBody(req);
      const difficulty = body.difficulty || "normal";
      if (!["easy", "normal", "hard"].includes(difficulty)) {
        return json(res, 400, { error: "difficulty must be easy, normal, or hard" });
      }
      return json(res, 200, await startSession(difficulty));
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      await ensureSession();
      return json(res, 200, await page.evaluate(() => window.BlackgateAI.getState()));
    }

    if (url.pathname === "/api/action" && req.method === "POST") {
      await ensureSession();
      const body = await readBody(req);
      const action = body.action;
      if (!["start", "continue", "allow", "reject", "search", "isolate", "next_day"].includes(action)) {
        return json(res, 400, { error: "invalid action" });
      }
      const state = await page.evaluate(a => window.BlackgateAI.act(a), action);
      return json(res, 200, state);
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return json(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(port, host, async () => {
  try {
    await startSession("normal");
    console.log(`Blackgate AI API: http://${host}:${port}/api/state`);
    console.log(`Human/visual view: http://${host}:${port}/`);
  } catch (error) {
    console.error("Failed to initialize browser:", error);
  }
});

async function shutdown() {
  try { if (context) await context.close(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
