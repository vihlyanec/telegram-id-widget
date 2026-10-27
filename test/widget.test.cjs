const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const code = fs.readFileSync(path.join(__dirname, "../public/widget.js"), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

async function setup(fetcher) {
  const dom = new JSDOM('<form><input name="username"><input name="gc_id"><button type="submit">Send</button></form>', {
    url: "https://school.example", runScripts: "dangerously",
  });
  dom.window.fetch = fetcher;
  const script = dom.window.document.createElement("script");
  script.setAttribute("data-username-selector", 'input[name="username"]');
  script.setAttribute("data-id-selector", 'input[name="gc_id"]');
  script.textContent = code;
  dom.window.document.body.append(script);
  await tick();
  const document = dom.window.document;
  return { dom, document, input: document.querySelector('[name="username"]'), id: document.querySelector('[name="gc_id"]') };
}

test("widget fills existing CRM field, emits events and clears stale ID", async t => {
  const { dom, document, input, id } = await setup(async () => ({ ok: true, json: async () => ({ username: "example", telegram_id: "123" }) }));
  t.after(() => dom.window.close());
  let changes = 0;
  id.addEventListener("change", () => changes++);
  input.value = "@Example";
  input.dispatchEvent(new dom.window.Event("blur"));
  await tick();
  assert.equal(id.value, "123");
  assert.equal(input.dataset.tgidState, "success");
  assert.ok(changes > 0);
  input.value = "@another";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(id.value, "");
  assert.equal(document.querySelectorAll('[name="telegram_id"]').length, 0);
});

test("late old response cannot replace new input; API errors remain visible", async t => {
  let release;
  const { dom, input, id } = await setup(() => new Promise(resolve => { release = resolve; }));
  t.after(() => dom.window.close());
  input.value = "@oldname";
  input.dispatchEvent(new dom.window.Event("blur"));
  input.value = "@newname";
  input.dispatchEvent(new dom.window.Event("input"));
  release({ ok: true, json: async () => ({ username: "oldname", telegram_id: "999" }) });
  await tick();
  assert.equal(id.value, "");
  dom.window.fetch = async () => ({ ok: false, json: async () => ({ error: "Аккаунт не найден" }) });
  input.dispatchEvent(new dom.window.Event("blur"));
  await tick();
  assert.equal(input.dataset.tgidState, "error");
  assert.match(dom.window.document.querySelector('.tgid-status').textContent, /не найден/);
});

test("click-based AJAX handlers run once after ID is ready, including repeated clicks", async t => {
  let release;
  let calls = 0;
  const { dom, document, input, id } = await setup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  t.after(() => dom.window.close());
  const button = document.querySelector('button');
  let sent = 0;
  button.addEventListener("click", event => { event.preventDefault(); assert.equal(id.value, "123"); sent++; });
  input.value = "@example";
  button.click();
  button.click();
  assert.equal(sent, 0);
  assert.equal(calls, 1);
  release({ ok: true, json: async () => ({ username: "example", telegram_id: "123" }) });
  await tick();
  assert.equal(sent, 1);
});

test("new popup forms are attached and resolved independently", async t => {
  const { dom, document } = await setup(async (_url, options) => {
    const { username } = JSON.parse(options.body);
    return { ok: true, json: async () => ({ username, telegram_id: "456" }) };
  });
  t.after(() => dom.window.close());
  const form = document.createElement("form");
  form.innerHTML = '<input name="username"><input name="gc_id">';
  document.body.appendChild(form);
  await tick();
  form.elements.username.value = "@another";
  form.elements.username.dispatchEvent(new dom.window.Event("blur"));
  await tick();
  assert.equal(form.elements.gc_id.value, "456");
  assert.equal(document.querySelector('form [name="gc_id"]').value, "");
});

test("keyboard submit waits and resumes the normal submit event", async t => {
  const { dom, document, input, id } = await setup(async () => ({
    ok: true, json: async () => ({ username: "example", telegram_id: "789" }),
  }));
  t.after(() => dom.window.close());
  const form = document.querySelector("form");
  let sent = 0;
  form.addEventListener("submit", event => { event.preventDefault(); sent++; assert.equal(id.value, "789"); });
  input.value = "@example";
  form.requestSubmit();
  assert.equal(sent, 0);
  await tick();
  assert.equal(sent, 1);
});

test("failed lookup blocks click AJAX and leaves CRM field empty", async t => {
  const { dom, document, input, id } = await setup(async () => ({
    ok: false, json: async () => ({ error: "Нет аккаунта" }),
  }));
  t.after(() => dom.window.close());
  let sent = 0;
  const button = document.querySelector("button");
  button.addEventListener("click", event => { event.preventDefault(); sent++; });
  input.value = "@missing";
  button.click();
  await tick();
  assert.equal(sent, 0);
  assert.equal(id.value, "");
  assert.equal(input.dataset.tgidState, "error");
});

test("late change for the same username does not cancel a click waiting for lookup", async t => {
  let release;
  let calls = 0;
  const { dom, document, input, id } = await setup(() => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  });
  t.after(() => dom.window.close());
  let sent = 0;
  const button = document.querySelector('button');
  button.addEventListener('click', event => { event.preventDefault(); sent++; });
  input.value = '@example';
  button.click();
  input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(calls, 1);
  release({ ok: true, json: async () => ({ username: 'example', telegram_id: '123' }) });
  await tick();
  assert.equal(sent, 1);
  assert.equal(id.value, '123');
});
