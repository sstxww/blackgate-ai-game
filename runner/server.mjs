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

async function launchBrowser() {
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    if (process.platform === "win32") {
      return chromium.launch({ headless, channel: "msedge" });
    }
    throw error;
  }
}

async function startSession(difficulty = "normal", meta = {}) {
  if (!browser) browser = await launchBrowser();
  if (context) await context.close();
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`http://${host}:${port}/ai/agent.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BlackgateAI && !!window.BlackgateRunRecorder);
  await page.evaluate(level => window.BlackgateAI.setDifficulty(level), difficulty);
  const state = await page.evaluate(() => window.BlackgateAI.act("start"));
  await page.evaluate(({ difficulty, meta, state }) => {
    window.BlackgateRunRecorder.start({
      player_type: "ai",
      participant: meta.participant || "",
      model: meta.model || "API Agent",
      provider: meta.provider || "",
      difficulty,
      source: "json-api",
      prompt_profile: meta.prompt_profile || ""
    }, state);
  }, { difficulty, meta, state });
  return state;
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
      return json(res, 200, await startSession(difficulty, {
        model: body.model,
        provider: body.provider,
        participant: body.participant,
        prompt_profile: body.prompt_profile
      }));
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
      const state = await page.evaluate(async a => {
        const before = window.BlackgateAI.getState();
        if (!before.allowed_actions.includes(a)) {
          throw new Error("action not allowed in current phase: " + a);
        }
        const after = await window.BlackgateAI.act(a);
        window.BlackgateRunRecorder.recordAction(before, a, after);
        return after;
      }, action);
      return json(res, 200, state);
    }

    if (url.pathname === "/api/report" && req.method === "GET") {
      await ensureSession();
      const report = await page.evaluate(() => {
        const finished = window.BlackgateRunRecorder.get("latest");
        if (finished?.postmortem) return finished.postmortem;
        const active = window.BlackgateRunRecorder.active();
        return active ? { status: "running", run_id: active.id, days: active.days } : null;
      });
      return json(res, 200, report || { status: "no-run" });
    }

    if (url.pathname === "/api/runs" && req.method === "GET") {
      await ensureSession();
      return json(res, 200, await page.evaluate(() => window.BlackgateRunRecorder.runs()));
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
