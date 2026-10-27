const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUsername, createLookup, LookupError } = require("../lookup.cjs");

test("normalizes usernames and t.me links, rejects unrelated URLs and payloads", () => {
  for (const value of ["@Example", " example ", "https://t.me/Example", "t.me/example/"]) {
    assert.equal(normalizeUsername(value), "example");
  }
  for (const value of [null, {}, "https://evil.test/example", "t.me/+invite", "a b", "@", "a".repeat(33)]) {
    assert.equal(normalizeUsername(value), null);
  }
});

test("coalesces parallel requests and caches a result", async () => {
  let calls = 0;
  const lookup = createLookup(async username => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { username, telegram_id: "123" };
  }, { intervalMs: 0 });
  const [a, b] = await Promise.all([lookup("example"), lookup("example")]);
  assert.deepEqual(a, b);
  await lookup("example");
  assert.equal(calls, 1);
});

test("flood wait stops queued and new requests without extra Telegram calls", async () => {
  let calls = 0;
  const lookup = createLookup(async () => {
    calls++;
    throw { code: 420, seconds: 12 };
  }, { intervalMs: 0 });
  const result = await Promise.allSettled([lookup("first"), lookup("second")]);
  assert.equal(calls, 1);
  assert.ok(result.every(item => item.status === "rejected" && item.reason.status === 429));
  await assert.rejects(lookup("third"), error => error.retryAfter >= 11);
});

test("maps Telegram not found errors, hides unknown errors and bounds queue", async () => {
  const missing = createLookup(async () => { throw { errorMessage: "USERNAME_NOT_OCCUPIED" }; });
  await assert.rejects(missing("example"), error => error.code === "NOT_FOUND");
  const failure = createLookup(async () => { throw new Error("secret"); });
  await assert.rejects(failure("example"), error => !error.message.includes("secret"));
  let release;
  const queued = createLookup(() => new Promise(resolve => { release = resolve; }), { maxQueue: 1 });
  const first = queued("first");
  await assert.rejects(queued("second"), error => error instanceof LookupError && error.code === "BUSY");
  await Promise.resolve();
  release({ telegram_id: "1", username: "first" });
  await first;
});
