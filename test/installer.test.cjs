const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lib = path.resolve(__dirname, "../scripts/installer-lib.sh");

test("installer rejects shell/domain injection and accepts valid inputs", () => {
  const result = spawnSync("bash", ["-c", `
set -eu
. "$LIB"
valid_domain lookup.my-school.ru
! valid_domain 'example.com'
! valid_domain 'https://lookup.my-school.ru'
! valid_domain 'site.test; touch /tmp/unwanted'
! valid_domain '$(touch /tmp/unwanted).test'
valid_email admin@my-school.ru
! valid_email 'bad email'
valid_api_id 12345
! valid_api_id 0
! valid_api_id nope
valid_api_hash "$HASH"
valid_bot_token "$TOKEN"
`], { env: {...process.env, LIB:lib, HASH:"a".repeat(32), TOKEN:"123:"+"x".repeat(30)}, encoding:"utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("installer writes private .env without printing secrets", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-widget-config-"));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const target = path.join(dir, ".env");
  const result = spawnSync("bash", ["-c", '. "$LIB"; write_env "$TARGET"'], { env: {
    ...process.env, LIB:lib, TARGET:target, APP_DOMAIN:"lookup.my-school.ru", ACME_EMAIL:"admin@my-school.ru",
    TG_API_ID:"12345", TG_API_HASH:"a".repeat(32), TG_BOT_TOKEN:"123:"+"x".repeat(30),
  }, encoding:"utf8" });
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(target,"utf8"), /^ALLOWED_ORIGINS=\*$/m);
});
