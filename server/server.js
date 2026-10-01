"use strict";
/*
 * خادم صلّحها: مزامنة بين أجهزة المحل + صفحة تتبّع للعميل.
 * بلا مكتبات خارجية — Node 22.13+ و SQLite المدمجة.
 *
 *   PORT=8080 DATA_DIR=./data node server/server.js
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const WWW = process.env.WWW_DIR || path.join(__dirname, "..", "www");
const MAX_BODY = 25 * 1024 * 1024;
const PAGE_BYTES = 6 * 1024 * 1024;
const TYPES = new Set(["job", "customer", "part", "settings", "photo"]);

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "salliha.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS shops (id TEXT PRIMARY KEY, name TEXT, key_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS records (
    shop TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
    data TEXT, deleted INTEGER NOT NULL DEFAULT 0, track TEXT, origin TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY (shop, type, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records (shop, seq);
  CREATE INDEX IF NOT EXISTS records_track ON records (track) WHERE track IS NOT NULL;
`);

const q = {
  shopByKey: db.prepare("SELECT * FROM shops WHERE key_hash = ?"),
  insertShop: db.prepare("INSERT INTO shops (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)"),
  maxSeq: db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM records WHERE shop = ?"),
  upsert: db.prepare(`INSERT INTO records (shop, type, id, seq, data, deleted, track, origin, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (shop, type, id) DO UPDATE SET seq = excluded.seq, data = excluded.data, deleted = excluded.deleted, track = excluded.track, origin = excluded.origin, updated_at = excluded.updated_at`),
  // لا نعيد للجهاز ما كتبه هو آخر مرة — عنده بالفعل.
  since: db.prepare("SELECT type, id, seq, data, deleted FROM records WHERE shop = ? AND seq > ? AND (origin IS NULL OR origin != ?) ORDER BY seq LIMIT 500"),
  byTrack: db.prepare("SELECT shop, data FROM records WHERE track = ? AND type = 'job' AND deleted = 0"),
  settings: db.prepare("SELECT data FROM records WHERE shop = ? AND type = 'settings' AND id = 'shop' AND deleted = 0")
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* ---------- أدوات HTTP ---------- */
function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", ...extra });
  res.end(data);
}
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("الطلب كبير جداً"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("JSON غير صالح"), { status: 400 })); } });
    req.on("error", reject);
  });
}
function auth(req) {
  const key = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return key ? q.shopByKey.get(sha(key)) : undefined;
}

// حدّ بسيط لإنشاء الحسابات لكل IP.
const createLog = new Map();
function rateLimited(ip) {
  const now = Date.now(), list = (createLog.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now); createLog.set(ip, list);
  return list.length > 10;
}

/* ---------- API ---------- */
async function createShop(req, res) {
  if (rateLimited(req.socket.remoteAddress)) return send(res, 429, { error: "محاولات كثيرة، حاول بعد ساعة" });
  const body = await readJSON(req);
  const id = crypto.randomUUID();
  // الرمز يُعرض مرة واحدة ويُحفظ مشفّراً فقط.
  const key = "SL-" + crypto.randomBytes(18).toString("base64url");
  q.insertShop.run(id, String(body.name || "").slice(0, 80), sha(key), new Date().toISOString());
  send(res, 201, { shopId: id, key });
}

async function sync(req, res) {
  const shop = auth(req);
  if (!shop) return send(res, 401, { error: "رمز المزامنة غير صحيح" });
  const body = await readJSON(req);
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const now = new Date().toISOString();
  const device = typeof body.device === "string" ? body.device.slice(0, 64) : null;
  let applied = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    let seq = q.maxSeq.get(shop.id).s;
    for (const c of changes) {
      if (!TYPES.has(c.type) || typeof c.id !== "string" || !c.id || c.id.length > 80) continue;
      const deleted = c.deleted ? 1 : 0;
      const data = deleted ? null : JSON.stringify(c.data ?? null);
      const track = !deleted && c.type === "job" && typeof c.data?.track === "string" ? c.data.track.slice(0, 40) : null;
      q.upsert.run(shop.id, c.type, c.id, ++seq, data, deleted, track, device, now);
      applied++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // إرجاع التغييرات منذ آخر رقم عند العميل، بحد أقصى للحجم.
  const since = Number(body.since) || 0;
  const out = [];
  let bytes = 0, rev = since, more = false;
  const rows = q.since.all(shop.id, since, device || "");
  for (const r of rows) {
    const len = r.data ? r.data.length : 0;
    if (out.length && bytes + len > PAGE_BYTES) { more = true; break; }
    bytes += len; rev = r.seq;
    out.push({ type: r.type, id: r.id, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null });
  }
  if (!more && rows.length === 500) more = true;
  if (!more) rev = Math.max(rev, q.maxSeq.get(shop.id).s);
  send(res, 200, { applied, changes: out, rev, more, shopName: shop.name });
}

/* ---------- صفحة التتبّع ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STEPS = ["تم الاستلام", "قيد الفحص", "قيد التصليح", "جاهز", "تم التسليم"];
const STEP_OF = { "تم الاستلام": 0, "قيد الفحص": 1, "انتظار الموافقة": 1, "انتظار قطعة": 2, "قيد التصليح": 2, "جاهز": 3, "تم التسليم": 4, "أُعيد دون تصليح": 4 };
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" }) : "");
const num = (v) => new Intl.NumberFormat("ar", { maximumFractionDigits: 2 }).format(Number(v) || 0);

function trackPage(job, s) {
  const step = STEP_OF[job.status] ?? 0;
  const paid = (job.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const due = Math.max(0, (Number(job.price) || 0) - paid);
  const cur = s.currency ? " " + esc(s.currency) : "";
  const firstName = String(job.customer || "").trim().split(/\s+/)[0];
  let warranty = "";
  if (job.status === "تم التسليم" && job.deliveredAt && job.warrantyDays) {
    const end = new Date(new Date(job.deliveredAt).getTime() + job.warrantyDays * 86400000);
    warranty = end > new Date() ? `<div class="note ok">🛡️ جهازك ضمن الضمان حتى <b>${fmt(end.toISOString())}</b></div>` : `<div class="note">انتهى الضمان في ${fmt(end.toISOString())}</div>`;
  }
  const special = { "انتظار الموافقة": "ننتظر موافقتك على تكلفة التصليح — تواصل معنا.", "انتظار قطعة": "ننتظر وصول قطعة الغيار، وسنبلغك فور وصولها.", "جاهز": "جهازك جاهز! تفضّل باستلامه.", "أُعيد دون تصليح": "نعتذر، لم نتمكن من تصليح الجهاز. يمكنك استلامه في أي وقت." }[job.status];
  const history = (job.history || []).filter((h) => /الحالة|تم الاستلام|جاهز|التسليم/.test(h.text)).slice(-8).reverse();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="120"><title>تتبّع ${esc(job.number)} — ${esc(s.shopName || "صلّحها")}</title>
<style>
:root{--g:#12372a;--g2:#1d5a43;--mint:#dff3e8;--ink:#18231e;--mu:#66756d;--line:#dde5e0;--bg:#f4f7f5;--card:#fff}
@media(prefers-color-scheme:dark){:root{--ink:#e6eee9;--mu:#98a8a0;--line:#2a3832;--bg:#0f1713;--card:#17211c;--mint:#1d3a2d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",Tahoma,Arial,sans-serif;line-height:1.6}
.wrap{max-width:520px;margin:auto;padding:20px 16px 40px}header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.logo{width:42px;height:42px;border-radius:12px;background:var(--g);color:#fff;display:grid;place-items:center;font-weight:900;font-size:22px}
header small{display:block;color:var(--mu)}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:12px}
h1{font-size:22px;margin:0}.num{font-family:monospace;color:#438062;font-weight:800}.status{display:inline-block;margin-top:8px;background:var(--mint);color:var(--g2);padding:5px 14px;border-radius:99px;font-weight:800}
.steps{display:flex;justify-content:space-between;position:relative;margin:22px 0 6px}.steps:before{content:"";position:absolute;top:13px;right:14px;left:14px;height:4px;background:var(--line);border-radius:4px}
.steps .bar{position:absolute;top:13px;right:14px;height:4px;background:var(--g2);border-radius:4px;width:calc((100% - 28px) * ${step / 4})}
.st{position:relative;text-align:center;font-size:11px;color:var(--mu);width:20%}.st i{display:block;width:30px;height:30px;margin:0 auto 4px;border-radius:50%;background:var(--card);border:4px solid var(--line);font-style:normal;line-height:22px;font-size:13px}
.st.done i{background:var(--g2);border-color:var(--g2);color:#fff}.st.done{color:var(--ink);font-weight:700}
.note{background:var(--mint);border-radius:12px;padding:10px 14px;margin-top:12px}.note.ok{background:#d1fadf;color:#05603a}
.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed var(--line)}.row:last-child{border:0}.row span{color:var(--mu)}
.due{color:#b42318}ol{list-style:none;margin:0;padding:0}li{padding:4px 0;font-size:14px}li time{color:var(--mu);font-size:12px;margin-inline-start:8px}
.btn{display:block;text-align:center;background:var(--g);color:#fff;text-decoration:none;padding:12px;border-radius:12px;font-weight:700;margin-top:8px}
footer{text-align:center;color:var(--mu);font-size:12px;margin-top:18px}
</style></head><body><div class="wrap">
<header><div class="logo">ص</div><div><strong>${esc(s.shopName || "صلّحها")}</strong><small>${esc(s.shopAddress || "")}</small></div></header>
<div class="card"><div class="num">${esc(job.number)}</div><h1>${esc(job.device)}</h1><div>مرحباً ${esc(firstName)} 👋</div><span class="status">${esc(job.status)}</span>
<div class="steps"><div class="bar"></div>${STEPS.map((t, i) => `<div class="st${i <= step ? " done" : ""}"><i>${i <= step ? "✓" : i + 1}</i>${t}</div>`).join("")}</div>
${special ? `<div class="note">${special}</div>` : ""}${warranty}</div>
<div class="card"><div class="row"><span>تاريخ الاستلام</span><b>${fmt(job.createdAt)}</b></div>
${job.dueAt && step < 3 ? `<div class="row"><span>الموعد المتوقع</span><b>${fmt(job.dueAt)}</b></div>` : ""}
<div class="row"><span>العطل</span><b>${esc(job.issue)}</b></div>
${job.price ? `<div class="row"><span>التكلفة</span><b>${num(job.price)}${cur}</b></div><div class="row"><span>المتبقي</span><b class="${due ? "due" : ""}">${num(due)}${cur}</b></div>` : ""}</div>
${history.length ? `<div class="card"><strong>آخر التحديثات</strong><ol>${history.map((h) => `<li>${esc(h.text.replace(/^الحالة: .* ← /, ""))}<time>${fmt(h.at)}</time></li>`).join("")}</ol></div>` : ""}
${s.shopPhone ? `<a class="btn" href="tel:${esc(s.shopPhone)}">📞 اتصل بالمحل ${esc(s.shopPhone)}</a>` : ""}
<footer>تُحدَّث الصفحة تلقائياً — بواسطة صلّحها</footer></div></body></html>`;
}
function notFoundPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير موجود</title>
<body style="font-family:Tahoma,sans-serif;text-align:center;padding:60px 20px;color:#444"><div style="font-size:50px">🔍</div><h2>لم نجد هذا الطلب</h2><p>تأكد من الرابط أو تواصل مع المحل.</p></body></html>`;
}

/* ---------- ملفات التطبيق (نسخة الويب) ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png" };
function serveStatic(req, res, pathname) {
  const rel = pathname === "/" || pathname === "/app" || pathname === "/app/" ? "index.html" : pathname.replace(/^\/(app\/)?/, "");
  const file = path.join(WWW, path.normalize(rel));
  if (!file.startsWith(WWW) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Not found", "text/plain");
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream", { "Cache-Control": "no-cache" });
}

/* ---------- التوجيه ---------- */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && pathname === "/api/shops") return await createShop(req, res);
    if (req.method === "POST" && pathname === "/api/sync") return await sync(req, res);
    const t = pathname.match(/^\/t\/([A-Za-z0-9_-]{6,40})$/);
    if (t && req.method === "GET") {
      const row = q.byTrack.get(t[1]);
      if (!row) return send(res, 404, notFoundPage(), "text/html; charset=utf-8");
      const s = JSON.parse(q.settings.get(row.shop)?.data || "{}");
      return send(res, 200, trackPage(JSON.parse(row.data), s), "text/html; charset=utf-8", { "Cache-Control": "no-store" });
    }
    if (req.method === "GET") return serveStatic(req, res, pathname);
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : "خطأ في الخادم" });
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`صلّحها: http://localhost:${PORT}`));
module.exports = { server, db };
