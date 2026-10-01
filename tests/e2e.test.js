// اختبارات الواجهة الكاملة في متصفح حقيقي: node --test tests/  (يتطلب playwright)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let chromium;
try { ({ chromium } = require("playwright")); } catch { test("e2e", { skip: "playwright غير مثبت" }, () => {}); return; }

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "salliha-e2e-"));
const { server } = require("../server/server.js");
let base, browser;
const errors = [];

test.before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
test.after(async () => { await browser?.close(); server.close(); });

async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => (d.message().includes("واتساب") ? d.dismiss() : d.accept(d.type() === "prompt" ? p.promptAnswer || "" : undefined)));
  await p.addInitScript(() => { window.print = () => { window.__printed = document.getElementById("printRoot").innerHTML; }; });
  await p.goto(base);
  return p;
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);

test("full shop workflow", async () => {
  const p = await device();
  await p.click("[data-tab=settings]");
  await p.fill("[name=shopName]", "محل الاختبار"); await p.fill("[name=currency]", "₪"); await p.fill("[name=techs]", "سامي، رامي");
  await p.click("#settingsForm .primary");

  // مخزون
  await p.click("[data-tab=stock]"); await p.click("#newPartBtn");
  await p.fill("#partName", "شاشة A52"); await p.fill("#partStock", "3"); await p.fill("#partMin", "1"); await p.fill("#partCost", "100"); await p.fill("#partPrice", "200");
  await p.click("#partForm .primary");

  // استلام جهاز بأرقام عربية
  await p.click("[data-tab=jobs]"); await p.click("#newJobBtn");
  await p.fill("#phone", "٠٥٩٩١٢٣٤٥٦"); await p.fill("#customer", "أحمد"); await p.fill("#device", "Samsung A52");
  await p.click("#issueChips button >> nth=0");
  await p.fill("#price", "٢٥٠"); await p.fill("#deposit", "٥٠"); await p.selectOption("#tech", "سامي");
  await p.click("[data-d=d-money]"); await p.fill("#partPick", "شاشة A52"); await p.click("#addPartBtn");
  await p.click("#saveAndPrint"); await p.waitForTimeout(200);
  let j = await ev(p, () => state.jobs[0]);
  assert.equal(j.price, 250); assert.equal(j.payments[0].amount, 50); assert.equal(j.phone, "0599123456");
  assert.equal(j.number, `S-${new Date().getFullYear()}-0001`);
  assert.equal(await ev(p, () => state.parts[0].stock), 2, "stock decremented");
  assert.match(await ev(p, () => window.__printed), /إيصال استلام/);

  // عميل سابق يُعرف من الهاتف + كشف الضمان
  await p.selectOption(".job-card select", "تم التسليم"); await p.waitForTimeout(100);
  await p.click("#newJobBtn"); await p.fill("#phone", "0599123456"); await p.dispatchEvent("#phone", "input");
  assert.equal(await p.inputValue("#customer"), "أحمد");
  await p.fill("#device", "Samsung A52"); await p.dispatchEvent("#device", "change");
  assert.ok(await p.isVisible("#warrantyHint"), "warranty detected");
  await p.click("#jobDialog [data-close] >> nth=0");

  // الصندوق: بيع ومصروف
  await p.click("[data-tab=cash]"); await p.click("#newSaleBtn");
  await p.fill("#salePick", "شاشة A52"); await p.dispatchEvent("#salePick", "change"); await p.click("#saleAdd");
  await p.fill("#saleDiscount", "20"); await p.click("#saleForm .primary");
  await p.click("#newExpBtn"); await p.fill("#expAmount", "30"); await p.click("#expForm .primary");
  const cash = await p.textContent("#cashStats");
  assert.match(cash, /50/); assert.match(cash, /180/); assert.match(cash, /30/); assert.match(cash, /200/, "net = 50 + 180 - 30");
  assert.equal(await ev(p, () => state.parts[0].stock), 1, "sale decremented stock");
  await p.click("#zBtn"); await p.waitForTimeout(150);
  assert.match(await ev(p, () => window.__printed), /إغلاق اليوم/);

  // التقارير: صافي الربح = (50 + 180) - (100 + 100) - 30
  await p.click("[data-tab=reports]");
  assert.match(await p.textContent("#kpis"), /-0|0 ₪صافي|صافي الربح/);
  const net = await ev(p, () => [...document.querySelectorAll("#kpis article")].find((a) => a.textContent.includes("صافي الربح")).querySelector("span").textContent);
  assert.match(net, /^0 ₪$|^٠ ₪$/);

  // الاستمرارية بعد إعادة التحميل
  await p.reload(); await p.waitForTimeout(300);
  assert.equal(await ev(p, () => state.jobs.length + state.sales.length + state.expenses.length), 3);
  assert.equal(await p.textContent("#shopTitle"), "محل الاختبار");
  await p.context().close();
});

test("two devices sync, unique job numbers, tracking page", async () => {
  const A = await device();
  await A.click("[data-tab=settings]"); await A.fill("[name=shopName]", "محل المزامنة"); await A.click("#settingsForm .primary");
  await A.fill("#syncUrl", base); await A.click("#syncCreate"); await A.waitForSelector("#syncOnBox:not([hidden])");
  const key = await A.inputValue("#syncKeyShow");

  const B = await device(); B.promptAnswer = key;
  await B.click("[data-tab=settings]"); await B.fill("#syncUrl", base); await B.click("#syncJoin");
  await B.waitForFunction(() => state.sync?.code === 2);
  assert.equal(await B.textContent("#shopTitle"), "محل المزامنة", "joining device keeps shop settings");

  // الجهازان ينشئان طلباً — أرقام مختلفة
  for (const [p, name] of [[A, "علي"], [B, "منى"]]) {
    await p.click("[data-tab=jobs]"); await p.click("#newJobBtn");
    await p.fill("#phone", "05970000" + (p === A ? "01" : "02")); await p.fill("#customer", name); await p.fill("#device", "iPhone 12"); await p.fill("#issue", "بطارية");
    await p.click("#saveBtn"); await p.waitForTimeout(150);
    await ev(p, () => doSync()); await p.waitForTimeout(300);
  }
  await ev(A, () => doSync()); await A.waitForTimeout(300);
  const numsA = await ev(A, () => state.jobs.map((j) => j.number).sort());
  const numsB = await ev(B, () => state.jobs.map((j) => j.number).sort());
  assert.equal(numsA.length, 2); assert.deepEqual(numsA, numsB);
  assert.notEqual(numsA[0], numsA[1], "no duplicate job numbers across devices");

  // تغيير الحالة في B يظهر في A وفي صفحة التتبّع
  await B.click("[data-tab=jobs]");
  const aliJob = await ev(B, () => state.jobs.find((j) => j.customer === "علي").id);
  await B.selectOption(`.job-card[data-id="${aliJob}"] select`, "جاهز"); await B.waitForTimeout(100);
  await ev(B, () => doSync()); await B.waitForTimeout(300); await ev(A, () => doSync()); await A.waitForTimeout(300);
  assert.equal(await ev(A, (id) => state.jobs.find((j) => j.id === id).status, aliJob), "جاهز");
  const url = await ev(A, (id) => trackURL(state.jobs.find((j) => j.id === id)), aliJob);
  const html = await (await fetch(url)).text();
  assert.match(html, /جهازك جاهز/); assert.match(html, /محل المزامنة/);
  assert.ok(await ev(A, (id) => receiptHTML(state.jobs.find((j) => j.id === id)).includes('class="qr"'), aliJob), "QR on receipt");
  await A.context().close(); await B.context().close();
});

test("mobile layout has no horizontal overflow", async () => {
  const p = await device({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const tap = (sel) => p.$eval(sel, (e) => e.click());
  await tap("[data-tab=settings]"); await tap("#demoBtn"); await p.waitForTimeout(200);
  for (const tab of ["jobs", "cash", "customers", "stock", "reports", "settings"]) {
    await tap(`[data-tab=${tab}]`); await p.waitForTimeout(50);
    const btn = await p.$eval(`[data-tab=${tab}]`, (e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    assert.ok(btn, `${tab} tab button fully on screen`);
    const over = await ev(p, () => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 1, `${tab} overflows by ${over}px`);
  }
  await p.context().close();
});

test("no page errors", () => assert.deepEqual(errors, []));
