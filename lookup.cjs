class LookupError extends Error {
  constructor(code, status, message, retryAfter = 0) {
    super(message);
    Object.assign(this, { code, status, retryAfter });
  }
}

function normalizeUsername(value) {
  if (typeof value !== "string" || value.length > 200) return null;
  let name = value.trim();
  const link = name.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([a-z0-9_]+)\/?$/i);
  name = link ? link[1] : name.replace(/^@/, "");
  return /^[a-z][a-z0-9_]{0,31}$/i.test(name) ? name.toLowerCase() : null;
}

function createLookup(resolve, { intervalMs = 3000, ttlMs = 300000, maxQueue = 8 } = {}) {
  const cache = new Map();
  const pending = new Map();
  let tail = Promise.resolve();
  let nextAt = 0;
  let blockedUntil = 0;
  const busy = () => new LookupError("RATE_LIMITED", 429,
    "Telegram временно ограничил поиск. Повторите позже.",
    Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)));

  return async function lookup(username) {
    const cached = cache.get(username);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (cached) cache.delete(username);
    if (Date.now() < blockedUntil) throw busy();
    if (pending.has(username)) return pending.get(username);
    if (pending.size >= maxQueue) {
      throw new LookupError("BUSY", 429, "Сервис занят. Повторите позже.", 10);
    }

    const task = tail.then(async () => {
      if (Date.now() < blockedUntil) throw busy();
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      try {
        const value = await resolve(username);
        if (cache.size >= 1000) cache.delete(cache.keys().next().value);
        cache.set(username, { value, expires: Date.now() + ttlMs });
        return value;
      } catch (error) {
        const code = error.errorMessage || "";
        if (error.code === 420 || code.startsWith("FLOOD_WAIT")) {
          const seconds = Number(error.seconds) || 60;
          blockedUntil = Date.now() + seconds * 1000;
          throw busy();
        }
        if (["USERNAME_INVALID", "USERNAME_NOT_OCCUPIED"].includes(code)) {
          throw new LookupError("NOT_FOUND", 404, "Такой Telegram-аккаунт не найден.");
        }
        if (error instanceof LookupError) throw error;
        throw new LookupError("UNAVAILABLE", 503,
          "Telegram сейчас недоступен. Повторите поиск позже.");
      } finally {
        nextAt = Date.now() + intervalMs;
      }
    });
    tail = task.catch(() => {});
    pending.set(username, task);
    try { return await task; } finally { pending.delete(username); }
  };
}

module.exports = { LookupError, normalizeUsername, createLookup };
