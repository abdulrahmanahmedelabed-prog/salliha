// اختبارات خادم المزامنة والتتبّع: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "salliha-test-"));
const { server } = require("../server/server.js");
let base;

test.before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
test.after(() => server.close());

const post = (p, body, key) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) }, body: JSON.stringify(body) });
async function newShop() { const r = await post("/api/shops", { name: "محل" }); assert.equal(r.status, 201); return (await r.json()).key; }

test("health", async () => { assert.equal((await fetch(base + "/health")).status, 200); });

test("rejects bad sync key", async () => {
  assert.equal((await post("/api/sync", { changes: [] }, "nope")).status, 401);
  assert.equal((await post("/api/sync", { changes: [] })).status, 401);
});

test("push from one device is pulled by another, not echoed back", async () => {
  const key = await newShop();
  const job = { id: "j1", number: "S-2026-0001", device: "iPhone", customer: "أحمد علي", status: "جاهز", track: "TRACKtoken1", price: 100, payments: [] };
  let r = await (await post("/api/sync", { since: 0, device: "A", changes: [{ type: "job", id: "j1", data: job }] }, key)).json();
  assert.equal(r.applied, 1);
  assert.equal(r.changes.length, 0, "own write is not echoed");
  assert.equal(r.deviceCode, 1);
  r = await (await post("/api/sync", { since: 0, device: "B", changes: [] }, key)).json();
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].data.customer, "أحمد علي");
  assert.equal(r.deviceCode, 2, "second device gets code 2");
  const rev = r.rev;
  r = await (await post("/api/sync", { since: rev, device: "B", changes: [] }, key)).json();
  assert.equal(r.changes.length, 0, "nothing new after rev");
});

test("shops are isolated", async () => {
  const k1 = await newShop(), k2 = await newShop();
  await post("/api/sync", { since: 0, device: "A", changes: [{ type: "part", id: "p1", data: { name: "x" } }] }, k1);
  const r = await (await post("/api/sync", { since: 0, device: "Z", changes: [] }, k2)).json();
  assert.equal(r.changes.length, 0);
});

test("deletes propagate and tracking page follows them", async () => {
  const key = await newShop();
  await post("/api/sync", { device: "A", changes: [{ type: "settings", id: "shop", data: { shopName: "محل <النور>", shopPhone: "0599" } }, { type: "job", id: "j2", data: { id: "j2", number: "S-1", device: "<script>x</script>", customer: "سارة خالد", status: "قيد التصليح", track: "trackDel123", phone: "0599111222", notes: "سري", passcode: "1234", price: 50, payments: [{ amount: 20 }] } }] }, key);
  let page = await fetch(base + "/t/trackDel123");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /محل &lt;النور&gt;/, "shop name escaped");
  assert.doesNotMatch(html, /<script>x<\/script>/, "device escaped");
  assert.doesNotMatch(html, /0599111222|سري|1234/, "no phone, notes or passcode on public page");
  assert.match(html, /سارة/);
  assert.doesNotMatch(html, /خالد/, "first name only");
  await post("/api/sync", { device: "A", changes: [{ type: "job", id: "j2", deleted: true }] }, key);
  assert.equal((await fetch(base + "/t/trackDel123")).status, 404);
  const r = await (await post("/api/sync", { since: 0, device: "B", changes: [] }, key)).json();
  assert.ok(r.changes.some((c) => c.id === "j2" && c.deleted));
});

test("ignores unknown record types", async () => {
  const key = await newShop();
  const r = await (await post("/api/sync", { device: "A", changes: [{ type: "evil", id: "x", data: 1 }, { type: "sale", id: "s1", data: { total: 5 } }] }, key)).json();
  assert.equal(r.applied, 1);
});

test("static files cannot escape www", async () => {
  const r = await fetch(base + "/..%2f..%2fserver%2fserver.js");
  assert.notEqual(r.status, 200);
  assert.equal((await fetch(base + "/")).status, 200);
});
