const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SetupError, readConfig, checkBotWebhook } = require("../config.cjs");
const token = "123456:" + "x".repeat(30);
const valid = () => ({ TG_API_ID: "12345", TG_API_HASH: "a".repeat(32), TG_BOT_TOKEN: token });

test("configuration defaults to universal mode and validates secrets without echoing them", () => {
  assert.deepEqual(readConfig(valid()).origins, ["*"]);
  for (const update of [{TG_API_ID:"0"},{TG_API_HASH:"private-invalid-value"},{TG_BOT_TOKEN:"private-invalid-value"},{ALLOWED_ORIGINS:"https://site.example/path"},{TRUST_PROXY_HOPS:"-1"}]) {
    assert.throws(() => readConfig({...valid(), ...update}), error =>
      error instanceof SetupError && !error.message.includes("private-invalid-value"));
  }
});

test("existing webhook stops startup without changing it", async () => {
  let calls = 0;
  await assert.rejects(checkBotWebhook(token, async url => {
    calls++;
    assert.ok(url.endsWith("/getWebhookInfo"));
    return {ok:true,json:async()=>({ok:true,result:{url:"https://existing.example/webhook"}})};
  }), error => error instanceof SetupError && /webhook/.test(error.message));
  assert.equal(calls, 1);
});

test("transport and API failures never leak the token-bearing URL", async () => {
  await assert.rejects(checkBotWebhook(token, async url => { throw new Error(url); }), error =>
    !error.message.includes(token) && !error.message.includes("https://"));
  await assert.rejects(checkBotWebhook(token, async () => ({ok:false,json:async()=>({ok:false})})), SetupError);
  await checkBotWebhook(token, async () => ({ok:true,json:async()=>({ok:true,result:{url:""}})}));
});
