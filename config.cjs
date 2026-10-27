class SetupError extends Error {}

function readConfig(env) {
  const apiId = Number(env.TG_API_ID);
  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new SetupError("В .env нужен положительный TG_API_ID из my.telegram.org.");
  }
  const apiHash = env.TG_API_HASH;
  if (!/^[a-f0-9]{32}$/i.test(apiHash || "")) {
    throw new SetupError("Проверьте TG_API_HASH в .env: нужны 32 символа без кавычек.");
  }
  const botToken = env.TG_BOT_TOKEN;
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken || "")) {
    throw new SetupError("Проверьте TG_BOT_TOKEN в .env: вставьте токен нового бота из BotFather.");
  }
  const origins = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim()).filter(Boolean);
  if (!origins.length) throw new SetupError("ALLOWED_ORIGINS не должен быть пустым; для всех сайтов укажите *.");
  for (const origin of origins) {
    if (origin === "*") continue;
    let url;
    try { url = new URL(origin); } catch { throw new SetupError("Неверный ALLOWED_ORIGINS: укажите * или HTTPS origins без путей."); }
    if (url.origin !== origin || (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new SetupError("ALLOWED_ORIGINS: нужны HTTPS origins без пути и конечного слеша.");
    }
  }
  const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new SetupError("TRUST_PROXY_HOPS должен быть целым неотрицательным числом.");
  return { apiId, apiHash, botToken, origins, proxyHops };
}

async function checkBotWebhook(botToken, request = fetch) {
  let response, data;
  try {
    response = await request("https://api.telegram.org/bot" + botToken + "/getWebhookInfo", {
      signal: AbortSignal.timeout(15000),
    });
    data = await response.json();
  } catch {
    // Never rethrow transport errors: their text may contain a token-bearing URL.
    throw new SetupError("Не удалось проверить бота. Проверьте доступ сервера к Telegram и TG_BOT_TOKEN.");
  }
  if (!response.ok || !data.ok || !data.result || typeof data.result.url !== "string") {
    throw new SetupError("Telegram не принял токен бота. Проверьте TG_BOT_TOKEN и доступ к Telegram.");
  }
  if (data.result.url) {
    throw new SetupError("Бот уже подключён через webhook. Создайте отдельного нового бота; существующий webhook не изменён.");
  }
}

module.exports = { SetupError, readConfig, checkBotWebhook };
