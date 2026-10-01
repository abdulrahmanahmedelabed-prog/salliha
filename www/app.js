"use strict";
/* صلّحها — نظام إدارة محلات الصيانة. يعمل دون إنترنت، والبيانات في IndexedDB على الجهاز. */

const VERSION = "2.1.0";
const STATUSES = ["تم الاستلام", "قيد الفحص", "انتظار الموافقة", "انتظار قطعة", "قيد التصليح", "جاهز", "تم التسليم", "أُعيد دون تصليح"];
const CLOSED = ["تم التسليم", "أُعيد دون تصليح"];
const STATUS_CLASS = ["s-new", "s-check", "s-wait", "s-wait", "s-work", "s-ready", "s-done", "s-back"];
const ACCESSORIES = ["شاحن", "كابل", "كفر", "شريحة", "ذاكرة", "قلم", "علبة", "بطارية"];
const CONDITIONS = ["خدوش", "شاشة مكسورة", "ظهر مكسور", "تلف سوائل", "لا يشتغل", "مفتوح سابقاً", "أزرار تالفة", "كاميرا تالفة"];
const COMMON_ISSUES = ["كسر شاشة", "بطارية", "منفذ الشحن", "لا يشحن", "سوفتوير", "سماعة", "مايك", "كاميرا", "تلف سوائل", "بصمة", "شبكة"];
const DEFAULT_TEMPLATES = {
  "تم الاستلام": "مرحباً {الاسم} 👋\nاستلمنا جهازك {الجهاز} برقم طلب {الرقم}.\nسنبلغك فور الانتهاء من الفحص.\nتابع حالة جهازك: {الرابط}\n{المحل}",
  "قيد الفحص": "مرحباً {الاسم}، جهازك {الجهاز} (طلب {الرقم}) قيد الفحص الآن.\n{المحل}",
  "انتظار الموافقة": "مرحباً {الاسم}، انتهينا من فحص {الجهاز}.\nتكلفة التصليح: {السعر}. هل توافق على البدء؟\n{المحل}",
  "انتظار قطعة": "مرحباً {الاسم}، طلب {الرقم} بانتظار وصول قطعة الغيار. سنبلغك فور وصولها.\n{المحل}",
  "قيد التصليح": "مرحباً {الاسم}، بدأنا تصليح {الجهاز} (طلب {الرقم}). الموعد المتوقع: {الموعد}.\nتابع حالة جهازك: {الرابط}\n{المحل}",
  "جاهز": "مرحباً {الاسم} ✅\nجهازك {الجهاز} جاهز للاستلام.\nالمبلغ المتبقي: {المتبقي}\n{المحل}",
  "تم التسليم": "شكراً لثقتك يا {الاسم} 🌟\nتم تسليم {الجهاز}. الضمان ساري حسب الإيصال رقم {الرقم}.\n{المحل}",
  "أُعيد دون تصليح": "مرحباً {الاسم}، نعتذر، لم نتمكن من تصليح {الجهاز} (طلب {الرقم}). يمكنك استلامه في أي وقت.\n{المحل}"
};
const DEFAULT_SETTINGS = {
  shopName: "صلّحها", shopPhone: "", shopAddress: "", currency: "", countryCode: "970", warrantyDays: 30,
  receiptSize: "80", techs: [], templates: {}, pinHash: "",
  terms: "• يرجى إحضار هذا الإيصال عند الاستلام.\n• المحل غير مسؤول عن البيانات، ننصح بنسخها احتياطياً.\n• الأجهزة غير المستلمة بعد 60 يوماً من إشعار الجاهزية لا يُسأل عنها المحل.\n• الضمان يشمل القطعة المستبدلة فقط ولا يشمل الكسر أو السوائل."
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const randomToken = (n = 10) => { const a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => a[x % a.length]).join(""); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const DAY = 86400000;
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("ar", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("ar", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

/* ---------- الأرقام والمبالغ ---------- */
function normalizeDigits(v) {
  return String(v ?? "").replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776);
}
function num(v) {
  const n = Number(normalizeDigits(v).replace(/[٬,\s]/g, "").replace("٫", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}
const cleanPhone = (v) => normalizeDigits(v).replace(/[^\d+]/g, "");
const phoneKey = (v) => cleanPhone(v).replace(/^\+/, "").replace(/^00/, "").replace(/^0+/, "").slice(-9);
function money(v) {
  const s = new Intl.NumberFormat("ar", { maximumFractionDigits: 2 }).format(Number(v) || 0);
  return state.settings.currency ? `${s} ${state.settings.currency}` : s;
}
const paidOf = (j) => j.payments.reduce((s, p) => s + p.amount, 0);
const partsCost = (j) => j.parts.reduce((s, p) => s + p.cost * p.qty, 0);
const dueOf = (j) => Math.max(0, j.price - paidOf(j));
const isClosed = (j) => CLOSED.includes(j.status);
const isLate = (j) => !isClosed(j) && j.status !== "جاهز" && j.dueAt && new Date(j.dueAt + "T23:59:59") < new Date();
function warrantyEnd(j) {
  if (j.status !== "تم التسليم" || !j.deliveredAt || !j.warrantyDays) return null;
  return new Date(new Date(j.deliveredAt).getTime() + j.warrantyDays * DAY);
}

/* ---------- التخزين (IndexedDB) ---------- */
const db = {
  _p: null,
  open() {
    return (this._p ||= new Promise((res, rej) => {
      const r = indexedDB.open("salliha", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("kv", mode), s = t.objectStore("kv");
      const r = fn(s);
      t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  get: (k) => db.tx("readonly", (s) => s.get(k)),
  set: (k, v) => db.tx("readwrite", (s) => s.put(v, k)),
  del: (k) => db.tx("readwrite", (s) => s.delete(k)),
  keys: () => db.tx("readonly", (s) => s.getAllKeys()),
  clear: () => db.tx("readwrite", (s) => s.clear())
};

let state = { v: 2, jobs: [], customers: [], parts: [], settings: { ...DEFAULT_SETTINGS } };
let saving = Promise.resolve();
function persist(fromSync = false) {
  saving = saving.then(() => db.set("state", state)).catch((e) => toast("تعذّر الحفظ: " + e.message, true));
  if (!fromSync) scheduleSync();
  return saving;
}

async function loadState() {
  try {
    const s = await db.get("state");
    if (s) state = s;
    else await migrateV1();
  } catch (e) {
    toast("تعذّر فتح قاعدة البيانات", true);
  }
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  state.jobs.forEach(normalizeJob);
}

function normalizeJob(j) {
  j.payments ||= []; j.parts ||= []; j.history ||= []; j.photos ||= []; j.accessories ||= []; j.conditions ||= [];
  j.priority ||= "عادي"; j.price = Number(j.price) || 0;
  j.track ||= randomToken();
  if (!STATUSES.includes(j.status)) j.status = STATUSES[0];
  return j;
}

// نقل بيانات النسخة الأولى (localStorage) تلقائياً.
async function migrateV1() {
  let old = [];
  try { old = JSON.parse(localStorage.getItem("salliha.jobs.v1") || "[]"); } catch {}
  if (!old.length) return;
  for (const o of old) {
    const cust = upsertCustomer(o.customer, o.phone);
    state.jobs.push(normalizeJob({
      id: o.id || uid(), number: o.number || nextNumber(), customerId: cust.id, customer: o.customer, phone: cleanPhone(o.phone),
      device: o.device, serial: o.serial || "", issue: o.issue || "", status: o.status, price: Number(o.price) || 0,
      payments: Number(o.paid) > 0 ? [{ id: uid(), amount: Number(o.paid), method: "نقداً", at: o.createdAt || now() }] : [],
      notes: o.notes || "", warrantyDays: DEFAULT_SETTINGS.warrantyDays, createdAt: o.createdAt || now(), updatedAt: o.updatedAt || now(),
      deliveredAt: o.status === "تم التسليم" ? o.updatedAt || now() : null,
      history: [{ at: o.createdAt || now(), text: "تم الاستلام (منقول من النسخة الأولى)" }]
    }));
  }
  await persist();
  toast(`تم نقل ${old.length} طلباً من النسخة السابقة`);
}

function nextNumber() {
  const year = new Date().getFullYear();
  const max = state.jobs.reduce((m, j) => {
    const [, y, n] = String(j.number).split("-");
    return Number(y) === year ? Math.max(m, Number(n) || 0) : m;
  }, 0);
  return `S-${year}-${String(max + 1).padStart(4, "0")}`;
}

function upsertCustomer(name, phone) {
  const key = phoneKey(phone);
  let c = key && state.customers.find((x) => phoneKey(x.phone) === key);
  if (!c) { c = { id: uid(), name: name.trim(), phone: cleanPhone(phone), notes: "", createdAt: now() }; state.customers.push(c); }
  else if (name && name.trim() !== c.name) c.name = name.trim();
  return c;
}

/* ---------- واجهة عامة ---------- */
let toastTimer;
function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = "toast"), 3200);
}
function fillSelect(sel, items, keepFirst = false) {
  const first = keepFirst ? sel.options[0]?.outerHTML || "" : "";
  sel.innerHTML = first + items.map((s) => `<option>${esc(s)}</option>`).join("");
}
function statusPill(el, status) {
  el.textContent = status;
  el.className = "status-pill " + STATUS_CLASS[STATUSES.indexOf(status)];
}

let currentTab = "jobs";
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + tab));
  renderTab();
  window.scrollTo({ top: 0 });
}
function renderTab() {
  ({ jobs: renderJobs, customers: renderCustomers, stock: renderParts, reports: renderReports, settings: renderSettings })[currentTab]();
}
function refreshLists() {
  $("custList").innerHTML = state.customers.map((c) => `<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join("");
  const devices = [...new Set(state.jobs.map((j) => j.device).filter(Boolean))].slice(-200);
  $("deviceList").innerHTML = devices.map((d) => `<option value="${esc(d)}">`).join("");
  $("partList").innerHTML = state.parts.map((p) => `<option value="${esc(p.name)}">${p.stock} متوفر</option>`).join("");
  const techs = state.settings.techs;
  fillSelect($("techFilter"), techs, true);
  $("tech").innerHTML = `<option value="">—</option>` + techs.map((t) => `<option>${esc(t)}</option>`).join("");
  $("shopTitle").textContent = state.settings.shopName || "صلّحها";
  $("lockShop").textContent = state.settings.shopName || "صلّحها";
}

/* ---------- الطلبات ---------- */
let view = "list";
let quick = "";
const QUICK_LABEL = { today: "استلام اليوم", active: "قيد العمل", ready: "جاهز للتسليم", late: "المتأخرة", due: "عليها مبالغ متبقية" };

function filteredJobs() {
  const q = normalizeDigits($("searchInput").value.trim().toLowerCase());
  const st = $("statusFilter").value, tech = $("techFilter").value;
  const today = startOfDay();
  return state.jobs.filter((j) => {
    if (st && j.status !== st) return false;
    if (tech && j.tech !== tech) return false;
    if (quick === "today" && new Date(j.createdAt) < today) return false;
    if (quick === "active" && (isClosed(j) || j.status === "جاهز")) return false;
    if (quick === "ready" && j.status !== "جاهز") return false;
    if (quick === "late" && !isLate(j)) return false;
    if (quick === "due" && !(dueOf(j) > 0 && j.status !== "أُعيد دون تصليح")) return false;
    if (!q) return true;
    return [j.number, j.customer, j.phone, j.device, j.serial, j.issue, j.tech].join(" ").toLowerCase().includes(q);
  }).sort((a, b) => (b.priority === "مستعجل") - (a.priority === "مستعجل") || (isClosed(a) - isClosed(b)) || b.createdAt.localeCompare(a.createdAt));
}

function renderStats() {
  const today = startOfDay();
  $("todayCount").textContent = state.jobs.filter((j) => new Date(j.createdAt) >= today).length;
  $("activeCount").textContent = state.jobs.filter((j) => !isClosed(j) && j.status !== "جاهز").length;
  $("readyCount").textContent = state.jobs.filter((j) => j.status === "جاهز").length;
  const late = state.jobs.filter(isLate).length;
  $("lateCount").textContent = late;
  $("lateCount").parentElement.classList.toggle("on", late > 0);
  $("dueTotal").textContent = money(state.jobs.filter((j) => j.status !== "أُعيد دون تصليح").reduce((s, j) => s + dueOf(j), 0));
  document.querySelectorAll(".stats [data-quick]").forEach((a) => a.classList.toggle("sel", a.dataset.quick === quick));
  $("todayLabel").textContent = new Date().toLocaleDateString("ar", { weekday: "long", day: "numeric", month: "long" });
}

function jobCard(j) {
  const node = $("jobTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.id = j.id;
  node.querySelector(".job-number").textContent = j.number;
  node.querySelector(".job-device").textContent = j.device;
  node.querySelector(".job-customer").textContent = `${j.customer} · ${j.phone}`;
  node.querySelector(".job-issue").textContent = j.issue;
  statusPill(node.querySelector(".status-pill"), j.status);
  const tags = node.querySelector(".tags");
  if (j.priority === "مستعجل") tags.insertAdjacentHTML("afterbegin", `<span class="tag urgent">مستعجل</span>`);
  if (isLate(j)) tags.insertAdjacentHTML("afterbegin", `<span class="tag late">متأخر</span>`);
  const w = warrantyEnd(j);
  if (w && w > new Date()) tags.insertAdjacentHTML("beforeend", `<span class="tag warranty">ضمان حتى ${fmtDate(w.toISOString())}</span>`);
  const meta = [];
  meta.push(`📅 ${fmtDate(j.createdAt)}`);
  if (j.dueAt && !isClosed(j)) meta.push(`⏰ موعد ${fmtDate(j.dueAt)}`);
  if (j.tech) meta.push(`👤 ${esc(j.tech)}`);
  if (j.photos.length) meta.push(`📷 ${j.photos.length}`);
  node.querySelector(".meta").innerHTML = meta.map((m) => `<span>${m}</span>`).join("");
  node.querySelector(".job-price").textContent = money(j.price);
  node.querySelector(".job-paid").textContent = money(paidOf(j));
  const due = node.querySelector(".job-due");
  due.textContent = money(dueOf(j));
  if (dueOf(j) > 0) due.classList.add("owe");
  const sel = node.querySelector("select");
  sel.innerHTML = STATUSES.map((s) => `<option${s === j.status ? " selected" : ""}>${s}</option>`).join("");
  if (j.priority === "مستعجل") node.classList.add("urgent");
  return node;
}

function renderJobs() {
  renderStats();
  const list = filteredJobs();
  $("empty").hidden = state.jobs.length > 0;
  const qn = $("quickNote");
  qn.hidden = !quick;
  if (quick) qn.innerHTML = `عرض: <b>${QUICK_LABEL[quick]}</b> (${list.length}) <button class="link" id="clearQuick">إلغاء التصفية ×</button>`;
  if (view === "list") {
    $("board").hidden = true; $("jobs").hidden = false;
    $("jobs").replaceChildren(...list.map(jobCard));
    if (state.jobs.length && !list.length) $("jobs").innerHTML = `<p class="no-results">لا توجد نتائج مطابقة</p>`;
  } else {
    $("jobs").hidden = true; $("board").hidden = false;
    const weekAgo = Date.now() - 7 * DAY;
    $("board").innerHTML = STATUSES.map((s) => {
      const items = list.filter((j) => j.status === s && (!isClosed(j) || new Date(j.updatedAt) > weekAgo));
      return `<div class="col" data-status="${s}"><h4><span class="status-pill ${STATUS_CLASS[STATUSES.indexOf(s)]}">${s}</span><b>${items.length}</b></h4>
        ${items.map((j) => `<div class="mini-card${j.priority === "مستعجل" ? " urgent" : ""}${isLate(j) ? " late" : ""}" draggable="true" data-id="${j.id}">
          <small>${esc(j.number)}</small><strong>${esc(j.device)}</strong><span>${esc(j.customer)}</span>${dueOf(j) > 0 ? `<em>${money(dueOf(j))}</em>` : ""}</div>`).join("")}</div>`;
    }).join("");
  }
}

async function setStatus(j, status, silent = false) {
  if (j.status === status) return;
  j.history.push({ at: now(), text: `الحالة: ${j.status} ← ${status}` });
  j.status = status;
  j.updatedAt = now();
  if (status === "تم التسليم" && !j.deliveredAt) j.deliveredAt = now();
  if (status !== "تم التسليم") j.deliveredAt = null;
  await persist();
  renderJobs();
  if (!silent) toast(`${j.number}: ${status}`);
}

async function deleteJob(j) {
  const back = j.parts.filter((p) => p.partId).length;
  if (!confirm(`حذف الطلب ${j.number} نهائياً؟${back ? "\nستُعاد القطع المستخدمة إلى المخزون." : ""}`)) return;
  adjustStock(j.parts, []);
  state.jobs = state.jobs.filter((x) => x.id !== j.id);
  for (const p of j.photos) db.del("photo:" + p).catch(() => {});
  await persist();
  renderJobs();
  toast("تم الحذف");
}

/* ---------- واتساب ---------- */
function fillTemplate(tpl, j) {
  const map = {
    "{الاسم}": j.customer, "{الرقم}": j.number, "{الجهاز}": j.device, "{الحالة}": j.status, "{السعر}": money(j.price),
    "{المتبقي}": money(dueOf(j)), "{المحل}": [state.settings.shopName, state.settings.shopPhone].filter(Boolean).join(" — "),
    "{الموعد}": j.dueAt ? fmtDate(j.dueAt) : "قريباً", "{الرابط}": trackURL(j)
  };
  if (!map["{الرابط}"]) tpl = tpl.split("\n").filter((l) => !l.includes("{الرابط}")).join("\n");
  return tpl.replace(/\{[^}]+\}/g, (k) => map[k] ?? k);
}
function waNumber(phone) {
  let d = cleanPhone(phone).replace(/^\+/, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = (state.settings.countryCode || "970").replace(/\D/g, "") + d.slice(1);
  return d;
}
function openExternal(url) {
  if (window.Capacitor?.isNativePlatform?.()) location.href = url; // Capacitor يفتحها في واتساب/المتصفح
  else window.open(url, "_blank", "noopener");
}
function sendWhatsApp(j) {
  const tpl = state.settings.templates[j.status] || DEFAULT_TEMPLATES[j.status] || "";
  openExternal(`https://wa.me/${waNumber(j.phone)}?text=${encodeURIComponent(fillTemplate(tpl, j))}`);
  j.history.push({ at: now(), text: "أُرسل تحديث واتساب" });
  persist();
}

/* ---------- الطباعة: إيصال + ملصق بباركود ---------- */
const CODE39 = { "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn", S: "nnwnnnwwn", "-": "nwnnnnwnw", "*": "nwnnwnwnn" };
function barcodeSVG(text, h = 40) {
  let x = 0, bars = "";
  for (const ch of `*${text}*`) {
    const p = CODE39[ch] || CODE39["-"];
    [...p].forEach((e, i) => { const w = e === "w" ? 3 : 1; if (i % 2 === 0) bars += `<rect x="${x}" width="${w}" height="${h}"/>`; x += w; });
    x += 1;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function doPrint(html, pageCss) {
  $("printRoot").innerHTML = html;
  let st = $("pageStyle");
  if (!st) { st = document.createElement("style"); st.id = "pageStyle"; document.head.append(st); }
  st.textContent = `@media print{@page{${pageCss}}}`;
  const done = () => { $("printRoot").innerHTML = ""; };
  setTimeout(() => {
    if (window.AndroidBridge?.print) window.AndroidBridge.print(); // أندرويد: PrintManager الأصلي
    else { window.print(); done(); }
  }, 60);
}

function receiptHTML(j) {
  const s = state.settings;
  const rows = [["رقم الطلب", j.number], ["التاريخ", fmtDateTime(j.createdAt)], ["العميل", j.customer], ["الهاتف", j.phone], ["الجهاز", j.device]];
  if (j.serial) rows.push(["IMEI / S.N", j.serial]);
  rows.push(["العطل", j.issue]);
  if (j.accessories.length) rows.push(["المستلم معه", j.accessories.join("، ")]);
  if (j.conditions.length) rows.push(["حالته عند الاستلام", j.conditions.join("، ")]);
  if (j.dueAt) rows.push(["موعد التسليم المتوقع", fmtDate(j.dueAt)]);
  rows.push(["الحالة", j.status]);
  const w = warrantyEnd(j);
  return `<div class="receipt size-${s.receiptSize}">
    <header><h1>${esc(s.shopName || "صلّحها")}</h1>${s.shopAddress ? `<p>${esc(s.shopAddress)}</p>` : ""}${s.shopPhone ? `<p>☎ ${esc(s.shopPhone)}</p>` : ""}</header>
    <h2>${j.status === "تم التسليم" ? "إيصال تسليم" : "إيصال استلام جهاز"}</h2>
    ${barcodeSVG(j.number)}<p class="c mono">${esc(j.number)}</p>
    ${trackURL(j) ? `<div class="qr">${qrSVG(trackURL(j))}<small><b>تابع حالة جهازك</b><br>امسح الرمز بكاميرا الجوال</small></div>` : ""}
    <table>${rows.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join("")}</table>
    ${j.parts.length && j.status === "تم التسليم" ? `<p class="sub">القطع: ${j.parts.map((p) => esc(p.name) + (p.qty > 1 ? " ×" + p.qty : "")).join("، ")}</p>` : ""}
    <table class="totals"><tr><th>الإجمالي</th><td>${money(j.price)}</td></tr><tr><th>المدفوع</th><td>${money(paidOf(j))}</td></tr><tr class="big"><th>المتبقي</th><td>${money(dueOf(j))}</td></tr></table>
    ${w ? `<p class="c"><b>الضمان ${j.warrantyDays} يوماً — حتى ${fmtDate(w.toISOString())}</b></p>` : j.warrantyDays ? `<p class="c">ضمان ${j.warrantyDays} يوماً من تاريخ التسليم</p>` : ""}
    ${s.terms ? `<div class="terms">${esc(s.terms).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="sign"><div>توقيع العميل${j.signature ? `<img src="${j.signature}" alt="">` : "<span></span>"}</div><div>توقيع المحل<span></span></div></div>
    <p class="c thanks">شكراً لثقتكم 🌟</p></div>`;
}
function qrSVG(text) {
  if (typeof qrcode !== "function") return "";
  const q = qrcode(0, "M");
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}
function printReceipt(j) {
  const size = state.settings.receiptSize;
  doPrint(receiptHTML(j), size === "a4" ? "size:A4;margin:14mm" : `size:${size}mm auto;margin:3mm`);
}
function printLabel(j) {
  doPrint(`<div class="label"><b>${esc(j.number)}</b>${barcodeSVG(j.number, 30)}<span>${esc(j.customer)} · ${esc(j.phone)}</span><span>${esc(j.device)}</span>${j.passcode ? `<span>🔑 ${esc(j.passcode)}</span>` : ""}<small>${fmtDate(j.createdAt)}</small></div>`, "size:50mm 30mm;margin:1mm");
}

/* ---------- نافذة الطلب ---------- */
let draft = null;
let draftNewPhotos = [];
const photoCache = new Map();

async function photoURL(id) {
  if (!photoCache.has(id)) photoCache.set(id, await db.get("photo:" + id));
  return photoCache.get(id);
}

function openJob(j, preset = {}) {
  const isNew = !j;
  draft = isNew ? normalizeJob({
    id: uid(), number: nextNumber(), status: STATUSES[0], price: 0, warrantyDays: state.settings.warrantyDays,
    createdAt: now(), history: [], ...preset
  }) : structuredClone(j);
  draftNewPhotos = [];
  $("jobForm").reset();
  $("jobId").value = isNew ? "" : j.id;
  $("dialogTitle").textContent = isNew ? "استلام جهاز جديد" : `${draft.device} — ${draft.customer}`;
  $("jobNumLabel").textContent = draft.number;
  for (const k of ["customer", "phone", "device", "serial", "issue", "status", "priority", "tech", "dueAt", "passcode", "notes"]) $(k).value = draft[k] ?? "";
  if (!$("status").value) $("status").value = STATUSES[0];
  $("price").value = draft.price || "";
  $("warrantyDays").value = draft.warrantyDays ?? "";
  $("depositWrap").hidden = !isNew;
  $("trackBtn").hidden = !syncOn();
  renderChips("accChips", ACCESSORIES, draft.accessories);
  renderChips("condChips", CONDITIONS, draft.conditions);
  $("issueChips").innerHTML = COMMON_ISSUES.map((c) => `<button type="button">${c}</button>`).join("");
  renderPhotos(); renderUsed(); renderPayments(); renderTimeline(); loadSignature(draft.signature);
  checkWarranty();
  switchPane("d-info");
  $("jobDialog").showModal();
  (isNew ? $("phone") : $("issue")).focus();
}

function renderChips(id, items, selected) {
  const extra = selected.filter((s) => !items.includes(s));
  $(id).innerHTML = [...items, ...extra].map((c) => `<button type="button" class="${selected.includes(c) ? "on" : ""}">${esc(c)}</button>`).join("");
}
const chipValues = (id) => [...$(id).querySelectorAll("button.on")].map((b) => b.textContent);

function switchPane(id) {
  document.querySelectorAll(".dpane").forEach((p) => (p.hidden = p.id !== id));
  document.querySelectorAll("#dtabs button").forEach((b) => b.classList.toggle("active", b.dataset.d === id));
  if (id === "d-check") sizeSignature();
}

function checkWarranty() {
  const serial = $("serial").value.trim().toLowerCase(), pk = phoneKey($("phone").value), dev = $("device").value.trim().toLowerCase();
  const hit = state.jobs.find((j) => {
    if (j.id === draft.id) return false;
    const w = warrantyEnd(j);
    if (!w || w < new Date()) return false;
    return (serial && j.serial?.toLowerCase() === serial) || (pk && dev && phoneKey(j.phone) === pk && j.device.toLowerCase() === dev);
  });
  const el = $("warrantyHint");
  el.hidden = !hit;
  if (hit) el.innerHTML = `🛡️ هذا الجهاز ضمن الضمان حتى <b>${fmtDate(warrantyEnd(hit).toISOString())}</b> — الطلب السابق ${esc(hit.number)}: ${esc(hit.issue)}`;
}

function renderPhotos() {
  const box = $("photos");
  box.querySelectorAll(".ph").forEach((n) => n.remove());
  const add = box.querySelector(".add-photo");
  for (const id of draft.photos) {
    const d = document.createElement("div");
    d.className = "ph"; d.dataset.id = id;
    d.innerHTML = `<img alt=""><button type="button" class="x" title="حذف">×</button>`;
    photoURL(id).then((u) => { if (u) d.querySelector("img").src = u; });
    box.insertBefore(d, add);
  }
}

function downscale(file, max = 1280) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("صورة غير صالحة")); };
    img.src = url;
  });
}

function renderUsed() {
  $("usedRows").innerHTML = draft.parts.map((p, i) => `<tr><td>${esc(p.name)}${p.partId ? "" : ' <small class="muted">(خارج المخزون)</small>'}</td><td>${p.qty}</td><td>${money(p.cost * p.qty)}</td><td><button type="button" class="x" data-i="${i}">×</button></td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">لا توجد قطع</td></tr>`;
  renderMoneySummary();
}
function renderPayments() {
  $("payRows").innerHTML = draft.payments.map((p, i) => `<tr><td>${fmtDateTime(p.at)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td><td><button type="button" class="x" data-i="${i}">×</button></td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">لا توجد دفعات</td></tr>`;
  renderMoneySummary();
}
function renderMoneySummary() {
  const price = num($("price").value), paid = paidOf(draft) + ($("depositWrap").hidden ? 0 : num($("deposit").value)), cost = partsCost(draft);
  $("moneySummary").innerHTML = `<span>السعر<b>${money(price)}</b></span><span>المدفوع<b>${money(paid)}</b></span><span>المتبقي<b class="${price - paid > 0 ? "owe" : ""}">${money(Math.max(0, price - paid))}</b></span><span>تكلفة القطع<b>${money(cost)}</b></span><span>الربح<b class="${price - cost < 0 ? "owe" : "gain"}">${money(price - cost)}</b></span>`;
}
function renderTimeline() {
  $("timeline").innerHTML = [...draft.history].reverse().map((h) => `<li><time>${fmtDateTime(h.at)}</time>${esc(h.text)}</li>`).join("") || `<li class="muted">سيبدأ السجل بعد الحفظ</li>`;
}

// تعديل المخزون حسب الفرق بين القطع القديمة والجديدة.
function adjustStock(oldParts, newParts) {
  const delta = new Map();
  for (const p of oldParts) if (p.partId) delta.set(p.partId, (delta.get(p.partId) || 0) + p.qty);
  for (const p of newParts) if (p.partId) delta.set(p.partId, (delta.get(p.partId) || 0) - p.qty);
  for (const [id, d] of delta) { const part = state.parts.find((x) => x.id === id); if (part) part.stock += d; }
}

async function saveJob(andPrint = false) {
  const req = ["phone", "customer", "device", "issue"].find((k) => !$(k).value.trim());
  if (req) { switchPane("d-info"); $(req).focus(); $(req).reportValidity?.(); toast("أكمل الحقول المطلوبة *", true); return; }
  const old = state.jobs.find((j) => j.id === $("jobId").value);
  const j = draft;
  Object.assign(j, {
    customer: $("customer").value.trim(), phone: cleanPhone($("phone").value), device: $("device").value.trim(), serial: $("serial").value.trim(),
    issue: $("issue").value.trim(), priority: $("priority").value, tech: $("tech").value, dueAt: $("dueAt").value, passcode: $("passcode").value.trim(),
    notes: $("notes").value.trim(), price: num($("price").value), warrantyDays: num($("warrantyDays").value),
    accessories: chipValues("accChips"), conditions: chipValues("condChips"), signature: sigDirty ? $("sigPad").toDataURL("image/png") : sigEmpty ? null : j.signature, updatedAt: now()
  });
  const newStatus = $("status").value;
  const cust = upsertCustomer(j.customer, j.phone);
  j.customerId = cust.id;
  if (!old) {
    j.status = newStatus;
    j.history.unshift({ at: j.createdAt, text: j.status === STATUSES[0] ? "تم الاستلام" : `تم الاستلام — ${j.status}` });
    const dep = num($("deposit").value);
    if (dep > 0) { j.payments.push({ id: uid(), amount: dep, method: "نقداً", at: now() }); j.history.push({ at: now(), text: `عربون ${money(dep)}` }); }
    if (newStatus === "تم التسليم") j.deliveredAt = now();
  } else if (old.status !== newStatus) {
    j.history.push({ at: now(), text: `الحالة: ${old.status} ← ${newStatus}` });
    j.status = newStatus;
    j.deliveredAt = newStatus === "تم التسليم" ? old.deliveredAt || now() : null;
  }
  adjustStock(old?.parts || [], j.parts);
  const low = j.parts.map((p) => state.parts.find((x) => x.id === p.partId)).filter((p) => p && p.stock <= (p.min || 0));
  // حذف الصور التي أزيلت
  for (const id of old?.photos || []) if (!j.photos.includes(id)) db.del("photo:" + id).catch(() => {});
  if (old) state.jobs[state.jobs.indexOf(old)] = j; else state.jobs.push(j);
  draftNewPhotos = [];
  await persist();
  $("jobDialog").close();
  refreshLists(); renderJobs();
  toast(old ? "تم حفظ التعديلات" : `تم تسجيل الطلب ${j.number}`);
  if (low.length) setTimeout(() => toast(`⚠️ مخزون منخفض: ${low.map((p) => p.name).join("، ")}`, true), 1500);
  if (andPrint) printReceipt(j);
}

/* ---------- التوقيع ---------- */
let sigDirty = false, sigEmpty = true, drawing = false;
const sig = () => $("sigPad");
function sizeSignature() {
  const c = sig(), r = c.getBoundingClientRect();
  if (!r.width) return;
  const data = sigDirty ? c.toDataURL() : null;
  c.width = Math.round(r.width * devicePixelRatio); c.height = Math.round(160 * devicePixelRatio);
  if (data) drawImage(data); else if (!sigEmpty && draft?.signature) drawImage(draft.signature);
}
function drawImage(src) {
  const img = new Image();
  img.onload = () => sig().getContext("2d").drawImage(img, 0, 0, sig().width, sig().height);
  img.src = src;
}
function loadSignature(src) {
  const c = sig(); c.getContext("2d").clearRect(0, 0, c.width, c.height);
  sigDirty = false; sigEmpty = !src;
  if (src) drawImage(src);
}
function sigPoint(e) { const r = sig().getBoundingClientRect(); return [(e.clientX - r.left) * sig().width / r.width, (e.clientY - r.top) * sig().height / r.height]; }

/* ---------- العملاء ---------- */
function customerStats(c) {
  const jobs = state.jobs.filter((j) => j.customerId === c.id || phoneKey(j.phone) === phoneKey(c.phone));
  return { jobs, paid: jobs.reduce((s, j) => s + paidOf(j), 0), due: jobs.filter((j) => j.status !== "أُعيد دون تصليح").reduce((s, j) => s + dueOf(j), 0) };
}
function renderCustomers() {
  const q = normalizeDigits($("custSearch").value.trim().toLowerCase());
  const rows = state.customers.filter((c) => !q || (c.name + " " + c.phone).toLowerCase().includes(q))
    .map((c) => ({ c, ...customerStats(c) })).sort((a, b) => b.jobs.length - a.jobs.length);
  $("custRows").innerHTML = rows.map(({ c, jobs, paid, due }) => `<tr data-id="${c.id}"><td><b>${esc(c.name)}</b>${jobs.length >= 3 ? ' <span class="tag vip">دائم</span>' : ""}</td><td dir="ltr">${esc(c.phone)}</td><td>${jobs.length}</td><td>${money(paid)}</td><td class="${due > 0 ? "owe" : ""}">${money(due)}</td><td class="row-actions"><button class="ghost sm" data-a="open">فتح</button><button class="ghost sm" data-a="wa">واتساب</button></td></tr>`).join("")
    || `<tr><td colspan="6" class="muted c">لا يوجد عملاء بعد — يُضافون تلقائياً عند استلام أي جهاز</td></tr>`;
}
function openCustomer(c) {
  $("custForm").reset();
  $("custId").value = c?.id || "";
  $("custTitle").textContent = c ? c.name : "عميل جديد";
  $("custName").value = c?.name || ""; $("custPhone").value = c?.phone || ""; $("custNotes").value = c?.notes || "";
  $("custNewJob").hidden = !c;
  if (c) {
    const { jobs, paid, due } = customerStats(c);
    $("custHistory").innerHTML = `<div class="summary"><span>الطلبات<b>${jobs.length}</b></span><span>المدفوع<b>${money(paid)}</b></span><span>المتبقي<b class="${due > 0 ? "owe" : ""}">${money(due)}</b></span></div>
      <table class="table mini"><thead><tr><th>الطلب</th><th>الجهاز</th><th>العطل</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>${jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((j) => `<tr class="link-row" data-job="${j.id}"><td>${esc(j.number)}<br><small>${fmtDate(j.createdAt)}</small></td><td>${esc(j.device)}</td><td>${esc(j.issue)}</td><td>${esc(j.status)}</td><td>${money(j.price)}</td></tr>`).join("")}</tbody></table>`;
  } else $("custHistory").innerHTML = "";
  $("custDialog").showModal();
}

/* ---------- المخزون ---------- */
function renderParts() {
  const q = $("partSearch").value.trim().toLowerCase(), low = $("lowOnly").checked;
  const rows = state.parts.filter((p) => (!q || (p.name + " " + (p.sku || "")).toLowerCase().includes(q)) && (!low || p.stock <= (p.min || 0)))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  $("partRows").innerHTML = rows.map((p) => `<tr data-id="${p.id}" class="${p.stock <= (p.min || 0) ? "low" : ""}"><td><b>${esc(p.name)}</b></td><td>${esc(p.sku || "")}</td><td><button class="ghost sm" data-a="dec">−</button> <b>${p.stock}</b> <button class="ghost sm" data-a="inc">+</button>${p.stock <= (p.min || 0) ? ' <span class="tag late">ناقص</span>' : ""}</td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${money(p.cost * p.stock)}</td><td class="row-actions"><button class="ghost sm" data-a="edit">تعديل</button><button class="ghost sm danger" data-a="del">🗑</button></td></tr>`).join("")
    || `<tr><td colspan="7" class="muted c">${state.parts.length ? "لا نتائج" : "أضف قطع الغيار لتتبع الكميات وحساب الربح الحقيقي لكل طلب"}</td></tr>`;
  const total = state.parts.reduce((s, p) => s + p.cost * p.stock, 0);
  if (state.parts.length) $("partRows").insertAdjacentHTML("beforeend", `<tr class="foot"><td colspan="5">إجمالي قيمة المخزون</td><td colspan="2"><b>${money(total)}</b></td></tr>`);
}
function openPart(p) {
  $("partForm").reset();
  $("partId").value = p?.id || "";
  $("partName").value = p?.name || ""; $("partSku").value = p?.sku || ""; $("partStock").value = p?.stock ?? 1;
  $("partMin").value = p?.min ?? 1; $("partCost").value = p?.cost ?? ""; $("partPrice").value = p?.price ?? "";
  $("partDialog").showModal();
}

/* ---------- التقارير ---------- */
function bars(el, entries, fmt = (v) => v) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  el.innerHTML = entries.length ? entries.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="--w:${(v / max) * 100}%"></i><b>${fmt(v)}</b></div>`).join("") : `<p class="muted">لا بيانات</p>`;
}
function countBy(list, fn) {
  const m = new Map();
  for (const x of list) { const k = fn(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
}
function renderReports() {
  const days = Number($("period").value);
  const since = days ? startOfDay(new Date(Date.now() - (days - 1) * DAY)) : new Date(0);
  const inP = (iso) => iso && new Date(iso) >= since;
  const received = state.jobs.filter((j) => inP(j.createdAt));
  const delivered = state.jobs.filter((j) => j.status === "تم التسليم" && inP(j.deliveredAt));
  const pays = state.jobs.flatMap((j) => j.payments).filter((p) => inP(p.at));
  const revenue = pays.reduce((s, p) => s + p.amount, 0);
  const cost = delivered.reduce((s, j) => s + partsCost(j), 0);
  const tat = delivered.length ? delivered.reduce((s, j) => s + (new Date(j.deliveredAt) - new Date(j.createdAt)), 0) / delivered.length / DAY : 0;
  const outstanding = state.jobs.filter((j) => j.status !== "أُعيد دون تصليح").reduce((s, j) => s + dueOf(j), 0);
  const avgTicket = delivered.length ? delivered.reduce((s, j) => s + j.price, 0) / delivered.length : 0;
  const kpi = [["أجهزة مستلمة", received.length], ["تم تسليمها", delivered.length], ["الإيراد المحصّل", money(revenue)], ["تكلفة القطع", money(cost)],
    ["صافي الربح التقريبي", money(revenue - cost)], ["متوسط الفاتورة", money(avgTicket)], ["متوسط مدة التصليح", tat ? tat.toFixed(1) + " يوم" : "—"], ["ديون لدى العملاء", money(outstanding)]];
  $("kpis").innerHTML = kpi.map(([k, v]) => `<article><span>${v}</span><small>${k}</small></article>`).join("");

  // الرسم البياني: يومي حتى 31 يوماً، وإلا شهري لآخر 12 شهراً.
  let buckets;
  if (days && days <= 31) {
    const n = Math.max(days, 7);
    buckets = Array.from({ length: n }, (_, i) => { const d = startOfDay(new Date(Date.now() - (n - 1 - i) * DAY)); return { label: d.toLocaleDateString("ar", { day: "numeric", month: "numeric" }), from: d, to: new Date(+d + DAY) }; });
  } else {
    buckets = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - 11 + i); const e = new Date(d); e.setMonth(e.getMonth() + 1); return { label: d.toLocaleDateString("ar", { month: "short" }), from: d, to: e }; });
  }
  const all = state.jobs.flatMap((j) => j.payments);
  buckets.forEach((b) => (b.v = all.filter((p) => { const t = new Date(p.at); return t >= b.from && t < b.to; }).reduce((s, p) => s + p.amount, 0)));
  const max = Math.max(1, ...buckets.map((b) => b.v));
  $("chart").innerHTML = buckets.map((b) => `<div class="col-bar" title="${esc(b.label)}: ${money(b.v)}"><i style="--h:${(b.v / max) * 100}%"></i><small>${esc(b.label)}</small></div>`).join("");

  bars($("byStatus"), STATUSES.map((s) => [s, state.jobs.filter((j) => j.status === s && (!isClosed(j) || inP(j.updatedAt))).length]).filter((e) => e[1]));
  bars($("byDevice"), countBy(received, (j) => j.device.split(/\s+/)[0]));
  bars($("byIssue"), countBy(received.flatMap((j) => COMMON_ISSUES.filter((c) => j.issue.includes(c)).concat(COMMON_ISSUES.some((c) => j.issue.includes(c)) ? [] : ["أخرى"])), (x) => x));
  const techMap = new Map();
  for (const j of delivered) { const k = j.tech || "غير محدد"; techMap.set(k, (techMap.get(k) || 0) + 1); }
  bars($("byTech"), [...techMap].sort((a, b) => b[1] - a[1]), (v) => v + " جهاز");
}

/* ---------- الإعدادات والنسخ الاحتياطي ---------- */
function renderSettings() {
  const f = $("settingsForm"), s = state.settings;
  for (const k of ["shopName", "shopPhone", "shopAddress", "currency", "countryCode", "warrantyDays", "receiptSize", "terms"]) f.elements[k].value = s[k] ?? "";
  f.elements.techs.value = s.techs.join("، ");
  f.elements.pin.value = "";
  f.elements.pin.placeholder = s.pinHash ? "مفعّل ••••" : "غير مفعّل";
  $("tplFields").innerHTML = STATUSES.map((st, i) => `<label>${st}<textarea rows="2" data-tpl="${i}">${esc(s.templates[st] || DEFAULT_TEMPLATES[st])}</textarea></label>`).join("");
  $("version").textContent = "v" + VERSION;
  renderSyncSettings();
  const last = localStorage.getItem("salliha.lastBackup");
  $("backupHint").textContent = "البيانات محفوظة على هذا الجهاز فقط. " + (last ? `آخر نسخة احتياطية: ${fmtDateTime(last)}` : "لم تأخذ نسخة احتياطية بعد!");
}

async function sha(text) {
  if (!crypto.subtle) return "plain:" + text;
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("salliha:" + text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt("انسخ:", text); }
}

function download(name, text, type = "application/json") {
  if (window.AndroidBridge?.saveFile) { toast(window.AndroidBridge.saveFile(name, text)); return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function exportBackup() {
  const photos = {};
  for (const j of state.jobs) for (const id of j.photos) photos[id] = await db.get("photo:" + id);
  download(`salliha-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "salliha", v: 2, exportedAt: now(), state: { ...state, sync: undefined }, photos }));
  localStorage.setItem("salliha.lastBackup", now());
  renderSettings();
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("الملف غير صالح", true); }
  if (data.app !== "salliha" || !data.state?.jobs) return toast("هذا ليس ملف نسخة احتياطية لصلّحها", true);
  if (!confirm(`استرجاع ${data.state.jobs.length} طلباً و${data.state.customers?.length || 0} عميلاً؟\nسيتم استبدال البيانات الحالية.`)) return;
  await db.clear();
  for (const [id, url] of Object.entries(data.photos || {})) if (url) await db.set("photo:" + id, url);
  const keepSync = state.sync;
  state = { v: 2, jobs: [], customers: [], parts: [], ...data.state, sync: keepSync };
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  state.jobs.forEach(normalizeJob);
  photoCache.clear();
  await persist();
  refreshLists(); renderTab();
  toast("تم الاسترجاع بنجاح");
}
function exportCSV() {
  const head = ["رقم الطلب", "التاريخ", "العميل", "الهاتف", "الجهاز", "IMEI", "العطل", "الحالة", "الفني", "السعر", "المدفوع", "المتبقي", "تكلفة القطع", "الربح", "تاريخ التسليم"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = state.jobs.map((j) => [j.number, fmtDate(j.createdAt), j.customer, j.phone, j.device, j.serial, j.issue, j.status, j.tech, j.price, paidOf(j), dueOf(j), partsCost(j), j.price - partsCost(j), j.deliveredAt ? fmtDate(j.deliveredAt) : ""]);
  download(`salliha-jobs-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n"), "text/csv");
}

async function addDemo() {
  const names = [["محمد أحمد", "0599111222"], ["سارة خالد", "0598333444"], ["يوسف علي", "0597555666"], ["ليلى حسن", "0592777888"], ["عمر سعيد", "0569999000"]];
  const devices = ["Samsung A52", "iPhone 13", "Redmi Note 12", "iPhone 11", "Oppo A74", "Huawei Y9"];
  const issues = ["كسر شاشة", "بطارية تفرغ بسرعة", "منفذ الشحن لا يعمل", "سوفتوير — يعلق على الشعار", "سماعة المكالمات ضعيفة", "تلف سوائل"];
  if (!state.parts.length) state.parts.push(
    { id: uid(), name: "شاشة Samsung A52", sku: "SCR-A52", stock: 3, min: 1, cost: 120, price: 220 },
    { id: uid(), name: "بطارية iPhone 11", sku: "BAT-IP11", stock: 1, min: 2, cost: 45, price: 110 },
    { id: uid(), name: "منفذ شحن Type-C", sku: "USB-C", stock: 12, min: 4, cost: 8, price: 40 });
  for (let i = 0; i < 9; i++) {
    const [name, phone] = names[i % names.length], c = upsertCustomer(name, phone);
    const created = new Date(Date.now() - (i * 2.3 + 0.2) * DAY).toISOString();
    const status = STATUSES[[0, 1, 4, 5, 6, 6, 3, 2, 6][i]];
    const price = [180, 250, 90, 300, 120, 220, 60, 150, 110][i];
    const j = normalizeJob({ id: uid(), number: nextNumber(), customerId: c.id, customer: name, phone, device: devices[i % devices.length], serial: "", issue: issues[i % issues.length],
      status, priority: i === 2 ? "مستعجل" : "عادي", tech: state.settings.techs[i % (state.settings.techs.length || 1)] || "", dueAt: new Date(Date.parse(created) + 2 * DAY).toISOString().slice(0, 10),
      price, warrantyDays: 30, accessories: i % 2 ? ["شاحن"] : [], conditions: i % 3 ? [] : ["خدوش"], createdAt: created, updatedAt: created,
      payments: [{ id: uid(), amount: status === "تم التسليم" ? price : 50, method: "نقداً", at: created }],
      parts: i === 0 && state.parts[0] ? [{ partId: null, name: "شاشة (تجريبي)", qty: 1, cost: 110 }] : [],
      deliveredAt: status === "تم التسليم" ? new Date(Date.parse(created) + 1.5 * DAY).toISOString() : null,
      history: [{ at: created, text: "تم الاستلام — بيانات تجريبية" }] });
    state.jobs.push(j);
  }
  await persist(); refreshLists(); toast("أُضيفت بيانات تجريبية"); showTab("jobs");
}

/* ---------- ربط الأحداث ---------- */
function bind() {
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); });
  $("newJobBtn").addEventListener("click", () => openJob());
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); }));
  $("jobDialog").addEventListener("close", () => {
    for (const id of draftNewPhotos) { db.del("photo:" + id).catch(() => {}); photoCache.delete(id); }
    draftNewPhotos = [];
  });

  ["searchInput", "statusFilter", "techFilter"].forEach((id) => $(id).addEventListener("input", renderJobs));
  document.querySelector("#tab-jobs .stats").addEventListener("click", (e) => { const a = e.target.closest("[data-quick]"); if (a) { quick = quick === a.dataset.quick ? "" : a.dataset.quick; renderJobs(); } });
  $("quickNote").addEventListener("click", (e) => { if (e.target.id === "clearQuick") { quick = ""; renderJobs(); } });
  $("viewSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    view = b.dataset.view; localStorage.setItem("salliha.view", view);
    $("viewSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderJobs();
  });

  $("jobs").addEventListener("click", (e) => {
    const card = e.target.closest(".job-card"); if (!card) return;
    const j = state.jobs.find((x) => x.id === card.dataset.id), a = e.target.closest("[data-action]")?.dataset.action;
    if (!j || a === "status") return;
    if (a === "whatsapp") sendWhatsApp(j);
    else if (a === "print") printReceipt(j);
    else if (a === "label") printLabel(j);
    else if (a === "delete") deleteJob(j);
    else if (a === "edit" || !e.target.closest("button,select")) openJob(j);
  });
  $("jobs").addEventListener("change", async (e) => {
    if (e.target.dataset.action !== "status") return;
    const j = state.jobs.find((x) => x.id === e.target.closest(".job-card").dataset.id);
    await setStatus(j, e.target.value);
    if (["جاهز", "انتظار الموافقة", "تم التسليم"].includes(j.status) && confirm("إرسال تحديث للعميل عبر واتساب؟")) sendWhatsApp(j);
  });

  const board = $("board");
  board.addEventListener("click", (e) => { const c = e.target.closest(".mini-card"); if (c) openJob(state.jobs.find((x) => x.id === c.dataset.id)); });
  board.addEventListener("dragstart", (e) => { const c = e.target.closest(".mini-card"); if (c) e.dataTransfer.setData("text/plain", c.dataset.id); });
  board.addEventListener("dragover", (e) => { const col = e.target.closest(".col"); if (col) { e.preventDefault(); col.classList.add("over"); } });
  board.addEventListener("dragleave", (e) => e.target.closest(".col")?.classList.remove("over"));
  board.addEventListener("drop", (e) => {
    const col = e.target.closest(".col"); if (!col) return;
    e.preventDefault();
    const j = state.jobs.find((x) => x.id === e.dataTransfer.getData("text/plain"));
    if (j) setStatus(j, col.dataset.status);
  });

  // نافذة الطلب
  $("dtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) switchPane(b.dataset.d); });
  $("jobForm").addEventListener("submit", (e) => { e.preventDefault(); saveJob(); });
  $("saveAndPrint").addEventListener("click", () => saveJob(true));
  $("phone").addEventListener("input", () => {
    const c = state.customers.find((x) => phoneKey(x.phone) === phoneKey($("phone").value));
    if (c && !$("customer").value.trim()) { $("customer").value = c.name; toast(`عميل سابق: ${c.name} (${customerStats(c).jobs.length} طلبات)`); }
    checkWarranty();
  });
  $("serial").addEventListener("input", checkWarranty);
  $("device").addEventListener("change", checkWarranty);
  $("issueChips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const t = $("issue"); t.value = t.value.trim() ? t.value.trim() + "، " + b.textContent : b.textContent;
  });
  ["accChips", "condChips"].forEach((id) => $(id).addEventListener("click", (e) => e.target.closest("button")?.classList.toggle("on")));
  $("price").addEventListener("input", renderMoneySummary);
  $("deposit").addEventListener("input", renderMoneySummary);

  $("photoInput").addEventListener("change", async (e) => {
    for (const f of e.target.files) {
      try {
        const url = await downscale(f), id = uid();
        await db.set("photo:" + id, url); photoCache.set(id, url);
        draft.photos.push(id); draftNewPhotos.push(id);
      } catch (err) { toast(err.message, true); }
    }
    e.target.value = ""; renderPhotos();
  });
  $("photos").addEventListener("click", async (e) => {
    const ph = e.target.closest(".ph"); if (!ph) return;
    if (e.target.classList.contains("x")) { draft.photos = draft.photos.filter((x) => x !== ph.dataset.id); renderPhotos(); return; }
    $("photoView").querySelector("img").src = await photoURL(ph.dataset.id);
    $("photoView").showModal();
  });

  $("addPartBtn").addEventListener("click", () => {
    const name = $("partPick").value.trim(); if (!name) return $("partPick").focus();
    const qty = Math.max(1, Math.round(num($("partQty").value)) || 1);
    const part = state.parts.find((p) => p.name === name);
    const cost = $("partCostIn").value ? num($("partCostIn").value) : part?.cost || 0;
    if (part && part.stock < qty && !confirm(`المتوفر من "${name}" هو ${part.stock} فقط. متابعة؟`)) return;
    draft.parts.push({ partId: part?.id || null, name, qty, cost });
    $("partPick").value = ""; $("partQty").value = 1; $("partCostIn").value = "";
    if (part && !num($("price").value)) $("price").value = part.price * qty || "";
    renderUsed();
  });
  $("partPick").addEventListener("change", () => { const p = state.parts.find((x) => x.name === $("partPick").value); if (p) $("partCostIn").placeholder = `التكلفة ${p.cost}`; });
  $("usedRows").addEventListener("click", (e) => { const i = e.target.dataset.i; if (i != null) { draft.parts.splice(i, 1); renderUsed(); } });
  const addPay = (amount) => {
    if (!(amount > 0)) return $("payAmount").focus();
    draft.payments.push({ id: uid(), amount, method: $("payMethod").value, at: now() });
    draft.history.push({ at: now(), text: `دفعة ${money(amount)} (${$("payMethod").value})` });
    $("payAmount").value = ""; renderPayments(); renderTimeline();
  };
  $("addPayBtn").addEventListener("click", () => addPay(num($("payAmount").value)));
  $("payRestBtn").addEventListener("click", () => addPay(Math.max(0, num($("price").value) - paidOf(draft))));
  $("payRows").addEventListener("click", (e) => {
    const i = e.target.dataset.i; if (i == null) return;
    const [p] = draft.payments.splice(i, 1);
    draft.history.push({ at: now(), text: `حُذفت دفعة ${money(p.amount)}` });
    renderPayments(); renderTimeline();
  });
  $("addLogBtn").addEventListener("click", () => {
    const t = $("logNote").value.trim(); if (!t) return;
    draft.history.push({ at: now(), text: "📝 " + t }); $("logNote").value = ""; renderTimeline();
  });

  // التوقيع
  const pad = sig();
  pad.addEventListener("pointerdown", (e) => {
    drawing = true; pad.setPointerCapture(e.pointerId);
    const ctx = pad.getContext("2d"); ctx.lineWidth = 2.5 * devicePixelRatio; ctx.lineCap = "round"; ctx.strokeStyle = "#12372a";
    ctx.beginPath(); ctx.moveTo(...sigPoint(e));
  });
  pad.addEventListener("pointermove", (e) => { if (!drawing) return; const ctx = pad.getContext("2d"); ctx.lineTo(...sigPoint(e)); ctx.stroke(); sigDirty = true; sigEmpty = false; });
  pad.addEventListener("pointerup", () => (drawing = false));
  $("sigClear").addEventListener("click", () => { pad.getContext("2d").clearRect(0, 0, pad.width, pad.height); sigDirty = false; sigEmpty = true; });

  // العملاء
  $("custSearch").addEventListener("input", renderCustomers);
  $("newCustBtn").addEventListener("click", () => openCustomer(null));
  $("custRows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const c = state.customers.find((x) => x.id === tr.dataset.id);
    if (e.target.dataset.a === "wa") openExternal(`https://wa.me/${waNumber(c.phone)}`); else openCustomer(c);
  });
  $("custHistory").addEventListener("click", (e) => {
    const tr = e.target.closest("[data-job]"); if (!tr) return;
    $("custDialog").close(); openJob(state.jobs.find((j) => j.id === tr.dataset.job));
  });
  $("custNewJob").addEventListener("click", () => {
    const c = state.customers.find((x) => x.id === $("custId").value);
    $("custDialog").close(); openJob(null, { customer: c.name, phone: c.phone });
  });
  $("custForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("custId").value, name = $("custName").value.trim(), phone = cleanPhone($("custPhone").value);
    const dup = state.customers.find((x) => x.id !== id && phoneKey(x.phone) === phoneKey(phone));
    if (dup) return toast(`الرقم مسجل للعميل ${dup.name}`, true);
    let c = state.customers.find((x) => x.id === id);
    if (!c) state.customers.push((c = { id: uid(), createdAt: now() }));
    const oldKey = c.phone && phoneKey(c.phone);
    Object.assign(c, { name, phone, notes: $("custNotes").value.trim() });
    for (const j of state.jobs) if (j.customerId === c.id || (oldKey && phoneKey(j.phone) === oldKey)) { j.customer = name; j.phone = phone; j.customerId = c.id; }
    await persist(); $("custDialog").close(); refreshLists(); renderCustomers(); toast("تم حفظ العميل");
  });

  // المخزون
  $("partSearch").addEventListener("input", renderParts);
  $("lowOnly").addEventListener("change", renderParts);
  $("newPartBtn").addEventListener("click", () => openPart(null));
  $("partRows").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]"), a = e.target.dataset.a; if (!tr || !a) return;
    const p = state.parts.find((x) => x.id === tr.dataset.id);
    if (a === "edit") return openPart(p);
    if (a === "del") { if (!confirm(`حذف "${p.name}" من المخزون؟`)) return; state.parts = state.parts.filter((x) => x !== p); }
    if (a === "inc") p.stock++;
    if (a === "dec" && p.stock > 0) p.stock--;
    await persist(); refreshLists(); renderParts();
  });
  $("partForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let p = state.parts.find((x) => x.id === $("partId").value);
    if (!p) state.parts.push((p = { id: uid() }));
    Object.assign(p, { name: $("partName").value.trim(), sku: $("partSku").value.trim(), stock: Math.round(num($("partStock").value)), min: Math.round(num($("partMin").value)), cost: num($("partCost").value), price: num($("partPrice").value) });
    await persist(); $("partDialog").close(); refreshLists(); renderParts(); toast("تم حفظ القطعة");
  });

  $("period").addEventListener("change", renderReports);

  // الإعدادات
  $("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements, s = state.settings;
    for (const k of ["shopName", "shopPhone", "shopAddress", "currency", "countryCode", "receiptSize", "terms"]) s[k] = f[k].value.trim();
    s.warrantyDays = Math.round(num(f.warrantyDays.value));
    s.techs = f.techs.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
    s.templates = {};
    document.querySelectorAll("[data-tpl]").forEach((t) => { const st = STATUSES[t.dataset.tpl]; if (t.value.trim() !== DEFAULT_TEMPLATES[st]) s.templates[st] = t.value.trim(); });
    const pin = normalizeDigits(f.pin.value.trim());
    if (pin === "0") s.pinHash = "";
    else if (pin) s.pinHash = await sha(pin);
    await persist(); refreshLists(); renderSettings(); toast("تم حفظ الإعدادات");
  });
  $("exportBtn").addEventListener("click", exportBackup);
  $("syncCreate").addEventListener("click", () => connectSync(true));
  $("syncJoin").addEventListener("click", () => connectSync(false));
  $("syncNow").addEventListener("click", () => doSync());
  $("syncBadge").addEventListener("click", () => doSync());
  $("syncCopy").addEventListener("click", () => copyText($("syncKeyShow").value, "تم نسخ الرمز"));
  $("syncDisconnect").addEventListener("click", async () => {
    if (!confirm("فصل هذا الجهاز عن المزامنة؟ تبقى البيانات الحالية على الجهاز.")) return;
    state.sync = { url: "", key: "", rev: 0, hashes: {}, last: null, device: uid() };
    await persist(true); renderSyncSettings(); renderSyncBadge();
  });
  $("trackBtn").addEventListener("click", () => {
    const url = trackURL(draft);
    if (!$("jobId").value) return toast("احفظ الطلب أولاً ليعمل الرابط", true);
    copyText(url, "تم نسخ رابط التتبّع");
  });
  $("importFile").addEventListener("change", (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; });
  $("csvBtn").addEventListener("click", exportCSV);
  $("demoBtn").addEventListener("click", addDemo);
  $("wipeBtn").addEventListener("click", async () => {
    if (!confirm("مسح كل الطلبات والعملاء والمخزون والصور نهائياً؟" + (syncOn() ? "\n⚠️ المزامنة مفعّلة: ستُحذف من كل الأجهزة المرتبطة أيضاً." : ""))) return;
    if (prompt('للتأكيد اكتب: مسح') !== "مسح") return;
    await db.clear();
    state = { v: 2, jobs: [], customers: [], parts: [], settings: state.settings, sync: state.sync };
    await persist(); refreshLists(); renderTab(); toast("تم مسح البيانات");
  });

  // اختصارات لوحة المفاتيح
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === "n" || e.key === "ى") { e.preventDefault(); showTab("jobs"); openJob(); }
    if (e.key === "/") { e.preventDefault(); showTab("jobs"); $("searchInput").focus(); }
  });

  // تثبيت PWA
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
  $("installBtn").addEventListener("click", async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").hidden = true; });
  window.addEventListener("afterprint", () => { $("printRoot").innerHTML = ""; });
}


/* ---------- المزامنة بين الأجهزة ---------- */
// كل سجل يُقارن ببصمته عند آخر مزامنة: ما تغيّر يُرفع، وما اختفى يُرسل كمحذوف، ثم نسحب تغييرات الأجهزة الأخرى.
const syncCfg = () => (state.sync ||= { url: "", key: "", rev: 0, hashes: {}, last: null, device: uid() });
const syncOn = () => !!(state.sync?.url && state.sync?.key);
const baseURL = () => syncCfg().url.trim().replace(/\/+$/, "");
const trackURL = (j) => (syncOn() && j.track ? `${baseURL()}/t/${j.track}` : "");
let syncTimer = null, syncRunning = false, syncAgain = false, syncError = "";

function hash(str) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const sharedSettings = () => { const { pinHash, ...rest } = state.settings; return rest; };

function localRecords() {
  const m = new Map();
  for (const j of state.jobs) m.set("job:" + j.id, j);
  for (const c of state.customers) m.set("customer:" + c.id, c);
  for (const p of state.parts) m.set("part:" + p.id, p);
  m.set("settings:shop", sharedSettings());
  return m;
}

async function api(path, body, key = syncCfg().key) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(baseURL() + path, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}) }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || "HTTP " + r.status), { status: r.status });
    return d;
  } catch (e) {
    if (e.name === "AbortError" || e instanceof TypeError) throw new Error("تعذّر الوصول للخادم");
    throw e;
  } finally { clearTimeout(t); }
}

function scheduleSync(delay = 3000) {
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSync(), delay);
}

async function doSync() {
  if (!syncOn()) return;
  if (syncRunning) { syncAgain = true; return; }
  if (!navigator.onLine) { syncError = "غير متصل بالإنترنت"; renderSyncBadge(); return; }
  syncRunning = true; renderSyncBadge();
  const cfg = syncCfg();
  let pulled = 0;
  const pull = async () => {
    let more = true;
    while (more) {
      const r = await api("/api/sync", { since: cfg.rev, device: cfg.device, changes: [] });
      for (const c of r.changes) { await applyRemote(c); pulled++; }
      cfg.rev = r.rev; more = r.more;
    }
  };
  try {
    await saving;
    // جهاز ينضم لحساب موجود يسحب أولاً، حتى لا تطغى بياناته الافتراضية (كإعدادات المحل) على بيانات الحساب.
    if (!cfg.rev) await pull();
    // 1) رفع التغييرات المحلية على دفعات
    const recs = localRecords(), next = {}, changes = [];
    for (const [k, v] of recs) {
      const h = hash(JSON.stringify(v)); next[k] = h;
      if (cfg.hashes[k] !== h) { const i = k.indexOf(":"); changes.push({ type: k.slice(0, i), id: k.slice(i + 1), data: v }); }
    }
    for (const id of new Set(state.jobs.flatMap((j) => j.photos))) {
      const k = "photo:" + id; next[k] = "p";
      if (!cfg.hashes[k]) { const data = await db.get(k); if (data) changes.push({ type: "photo", id, data }); else delete next[k]; }
    }
    for (const k of Object.keys(cfg.hashes)) if (!(k in next) && !k.startsWith("photo:")) { const i = k.indexOf(":"); changes.push({ type: k.slice(0, i), id: k.slice(i + 1), deleted: true }); }
    let batch = [], size = 0;
    const flush = async () => { if (batch.length) await api("/api/sync", { since: Number.MAX_SAFE_INTEGER, device: cfg.device, changes: batch }); batch = []; size = 0; };
    for (const c of changes) {
      const n = c.data ? JSON.stringify(c.data).length : 50;
      if (size + n > 4e6) await flush();
      batch.push(c); size += n;
    }
    await flush();
    cfg.hashes = next;

    // 2) سحب تغييرات الأجهزة الأخرى
    await pull();
    cfg.last = now(); syncError = "";
    await persist(true);
    if (pulled) { refreshLists(); if (!document.querySelector("dialog[open]")) renderTab(); }
  } catch (e) {
    syncError = e.status === 401 ? "رمز المزامنة غير صحيح" : e.message;
  } finally {
    syncRunning = false;
    renderSyncBadge();
    if (currentTab === "settings") renderSyncSettings();
    if (syncAgain) { syncAgain = false; scheduleSync(500); }
  }
}

async function applyRemote(c) {
  const cfg = syncCfg(), k = c.type + ":" + c.id;
  if (c.type === "photo") {
    if (!c.deleted && c.data) { await db.set(k, c.data); photoCache.set(c.id, c.data); cfg.hashes[k] = "p"; }
    return;
  }
  if (c.type === "settings") {
    if (c.deleted || !c.data) return;
    state.settings = { ...DEFAULT_SETTINGS, ...c.data, pinHash: state.settings.pinHash };
    cfg.hashes[k] = hash(JSON.stringify(sharedSettings()));
    return;
  }
  const arr = { job: "jobs", customer: "customers", part: "parts" }[c.type];
  if (!arr) return;
  const i = state[arr].findIndex((x) => x.id === c.id);
  if (c.deleted) { if (i >= 0) state[arr].splice(i, 1); delete cfg.hashes[k]; return; }
  const v = c.type === "job" ? normalizeJob(c.data) : c.data;
  if (i >= 0) state[arr][i] = v; else state[arr].push(v);
  cfg.hashes[k] = hash(JSON.stringify(v));
}

function renderSyncBadge() {
  const b = $("syncBadge");
  b.hidden = !syncOn();
  if (!syncOn()) return;
  const last = state.sync.last;
  if (syncRunning) { b.className = "sync-badge busy"; b.textContent = "⟳ مزامنة…"; }
  else if (syncError) { b.className = "sync-badge err"; b.textContent = "⚠ لم تتم المزامنة"; b.title = syncError; }
  else { b.className = "sync-badge ok"; b.textContent = "☁ متزامن"; b.title = last ? "آخر مزامنة: " + fmtDateTime(last) : ""; }
}

function renderSyncSettings() {
  const on = syncOn(), cfg = syncCfg();
  $("syncOffBox").hidden = on; $("syncOnBox").hidden = !on;
  if (!$("syncUrl").value) $("syncUrl").value = cfg.url || (/^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.hostname) ? location.origin : "");
  if (on) {
    $("syncUrlShow").textContent = baseURL();
    $("syncKeyShow").value = cfg.key;
    $("syncStatus").textContent = syncRunning ? "جارٍ المزامنة…" : syncError ? "⚠ " + syncError : cfg.last ? "آخر مزامنة " + fmtDateTime(cfg.last) : "";
  }
}

async function connectSync(createNew) {
  let url = $("syncUrl").value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/.test(url)) { $("syncUrl").focus(); return toast("أدخل عنوان الخادم كاملاً، مثل https://…", true); }
  if (url.startsWith("http://") && !/localhost|127\.0\.0\.1|192\.168\./.test(url)) toast("يُنصح باستخدام https لحماية البيانات", true);
  const cfg = syncCfg();
  const prev = { ...cfg };
  cfg.url = url; cfg.rev = 0; cfg.hashes = {}; cfg.last = null;
  try {
    if (createNew) {
      const r = await api("/api/shops", { name: state.settings.shopName }, "");
      cfg.key = r.key;
    } else {
      const key = (prompt("أدخل رمز المزامنة من الجهاز الآخر (يبدأ بـ SL-)") || "").trim();
      if (!key) { Object.assign(cfg, prev); return; }
      cfg.key = key;
      await api("/api/sync", { since: Number.MAX_SAFE_INTEGER, device: cfg.device, changes: [] });
    }
  } catch (e) {
    Object.assign(cfg, prev);
    return toast(e.status === 401 ? "رمز المزامنة غير صحيح" : e.message, true);
  }
  await persist(true);
  renderSyncSettings();
  toast(createNew ? "تم إنشاء الحساب — انسخ الرمز لأجهزتك الأخرى" : "تم الربط، جارٍ جلب البيانات…");
  await doSync();
  renderSyncSettings();
}

async function unlock() {
  if (!state.settings.pinHash) return;
  $("lock").hidden = false;
  $("lockPin").focus();
  await new Promise((res) => {
    $("lockForm").onsubmit = async (e) => {
      e.preventDefault();
      if ((await sha(normalizeDigits($("lockPin").value.trim()))) === state.settings.pinHash) { $("lock").hidden = true; res(); }
      else { $("lockErr").textContent = "الرمز غير صحيح"; $("lockPin").value = ""; }
    };
  });
}

(async function init() {
  fillSelect($("statusFilter"), STATUSES, true);
  fillSelect($("status"), STATUSES);
  view = localStorage.getItem("salliha.view") === "board" ? "board" : "list";
  $("viewSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  bind();
  await loadState();
  await unlock();
  refreshLists();
  renderJobs();
  renderSyncBadge();
  doSync();
  setInterval(() => document.visibilityState === "visible" && doSync(), 30000);
  window.addEventListener("online", () => scheduleSync(500));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && scheduleSync(500));
  if (location.protocol.startsWith("http") && "serviceWorker" in navigator && !window.Capacitor) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
