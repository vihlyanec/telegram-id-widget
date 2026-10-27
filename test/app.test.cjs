const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../app.cjs");

test("HTTP contract: origin restrictions, preflight, validation, string ID, static isolation", async t => {
  let calls = 0;
  const app = createApp({ allowedOrigins: ["https://school.example"], lookup: async username => {
    calls++;
    return { username, telegram_id: "1234567890123" };
  } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (body, origin = "https://school.example") => fetch(base + "/api/telegram-id", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
  assert.equal((await request({ username: "@example" }, "https://evil.test")).status, 403);
  const preflight = await fetch(base + "/api/telegram-id", { method: "OPTIONS", headers: { Origin: "https://school.example" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://school.example");
  assert.equal((await request({ username: "bad name" })).status, 400);
  const response = await request({ username: "https://t.me/Example" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: "example", telegram_id: "1234567890123" });
  assert.equal(calls, 1);
  assert.equal((await fetch(base + "/.env")).status, 404);
  assert.equal((await fetch(base + "/data/bot.session")).status, 404);
  assert.equal((await fetch(base + "/widget.js")).status, 200);
  const malformed = await fetch(base + "/api/telegram-id", { method: "POST", headers: {
    Origin: "https://school.example", "Content-Type": "application/json",
  }, body: "{" });
  assert.equal(malformed.status, 400);
});

test("universal mode accepts different sites and exposes no credentials", async t => {
  const app = createApp({ allowedOrigins: ["*"], lookup: async username => ({ username, telegram_id: "123" }) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const origin of ["https://first.example", "https://second.example", "null"]) {
    const response = await fetch(base + "/api/telegram-id", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "example" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.deepEqual(Object.keys(await response.json()).sort(), ["telegram_id", "username"]);
  }
});
