require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { TelegramClient, Api } = require("teleproto");
const { StringSession } = require("teleproto/sessions");
const { createApp } = require("./app.cjs");
const { createLookup, LookupError } = require("./lookup.cjs");
const { SetupError, readConfig, checkBotWebhook } = require("./config.cjs");

async function main() {
  const { apiId, apiHash, botToken, origins, proxyHops } = readConfig(process.env);
  await checkBotWebhook(botToken);
  const sessionFile = path.resolve(process.env.SESSION_FILE || "./data/bot.session");
  let session = "";
  try { session = (await fs.readFile(sessionFile, "utf8")).trim(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3, requestRetries: 5, floodSleepThreshold: 0,
  });
  // Explicit bot sign-in: never ask for a personal phone number or login code.
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.invoke(new Api.auth.ImportBotAuthorization({
      flags: 0, apiId, apiHash, botAuthToken: botToken,
    }));
  }
  const me = await client.getMe();
  if (!me.bot || me.id.toString() !== botToken.split(":")[0]) {
    await client.disconnect();
    throw new SetupError("Файл сессии принадлежит другому аккаунту. Используйте отдельный SESSION_FILE или отдельную установку.");
  }
  await fs.mkdir(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(sessionFile, client.session.save(), { mode: 0o600 });
  await fs.chmod(sessionFile, 0o600);

  const lookup = createLookup(async username => {
    const result = await client.invoke(new Api.contacts.ResolveUsername({ username }));
    if (!(result.peer instanceof Api.PeerUser)) {
      throw new LookupError("NOT_A_PERSON", 422, "Это канал или группа. Укажите аккаунт человека.");
    }
    const user = result.users.find(u => u.id.toString() === result.peer.userId.toString());
    if (!user || user.deleted || user.bot) {
      throw new LookupError("NOT_A_PERSON", 422, "Укажите действующий аккаунт человека, а не бота.");
    }
    return { telegram_id: user.id.toString(), username };
  });
  const app = createApp({ lookup, allowedOrigins: origins, trustProxyHops: proxyHops });
  const server = app.listen(Number(process.env.PORT) || 3000, process.env.HOST || "127.0.0.1", () => {
    console.log("Telegram ID: сервер запущен. Основной бот и SaleBot не подключаются.");
  });
  async function stop() {
    server.close();
    await client.disconnect();
    process.exit(0);
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch(error => {
  console.error(error instanceof SetupError ? error.message :
    "Не удалось запустить сервер: проверьте .env, файл сессии и доступ к Telegram. Секреты не выводятся.");
  process.exit(1);
});
