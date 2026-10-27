const path = require("node:path");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { normalizeUsername } = require("./lookup.cjs");

function createApp({ lookup, allowedOrigins, trustProxyHops = 0 }) {
  const app = express();
  app.disable("x-powered-by");
  if (trustProxyHops) app.set("trust proxy", trustProxyHops);
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/widget.js", (_req, res) => res.sendFile(path.join(__dirname, "public/widget.js")));
  app.get(["/", "/demo.html"], (_req, res) => res.sendFile(path.join(__dirname, "public/demo.html")));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/telegram-id", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = req.get("Origin");
    const publicAccess = allowedOrigins.includes("*");
    if (!publicAccess && (!origin || !allowedOrigins.includes(origin))) {
      return res.status(403).json({ code: "ORIGIN_DENIED", error: "Этот сайт не подключён к поиску." });
    }
    res.set("Access-Control-Allow-Origin", publicAccess ? "*" : origin);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Expose-Headers", "Retry-After");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const limiter = rateLimit({
    windowMs: 60000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      code: "RATE_LIMITED", error: "Слишком много запросов. Повторите через минуту.",
    }),
  });

  app.post("/api/telegram-id", limiter, express.json({ limit: "2kb" }), async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    if (!username) return res.status(400).json({
      code: "INVALID_USERNAME", error: "Введите @username или ссылку t.me/username.",
    });
    try {
      res.json(await lookup(username));
    } catch (error) {
      if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
      res.status(error.status || 503).json({
        code: error.code || "UNAVAILABLE",
        error: error.status ? error.message : "Поиск сейчас недоступен.",
      });
    }
  });
  app.use((error, _req, res, _next) => {
    res.status(error.status === 413 ? 413 : 400).json({
      code: "INVALID_REQUEST", error: "Некорректный запрос.",
    });
  });
  return app;
}

module.exports = { createApp };
