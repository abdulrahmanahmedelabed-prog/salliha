"use strict";
const STORE="salliha.jobs.v1";
const $=id=>document.getElementById(id);
const fields=["jobId","customer","phone","device","serial","issue","price","paid","status","notes"];
let jobs=load();
let installPrompt=null;

function load(){try{return JSON.parse(localStorage.getItem(STORE)||"[]")}catch{return []}}
function save(){localStorage.setItem(STORE,JSON.stringify(jobs));render()}
function money(value){return new Intl.NumberFormat("ar",{maximumFractionDigits:2}).format(Number(value)||0)}
function todayKey(date=new Date()){return date.toISOString().slice(0,10)}
function nextNumber(){const year=new Date().getFullYear();const max=jobs.reduce((m,j)=>Math.max(m,Number(String(j.number||"").split("-").pop())||0),0);return `S-${year}-${String(max+1).padStart(4,"0")}`}
function normalizeDigits(value){return String(value??"").replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776).replace("٫","."))}
function numberValue(value){const normalized=normalizeDigits(value).replace(/[٬,]/g,"").replace("٫",".");const parsed=Number(normalized);return Number.isFinite(parsed)&&parsed>=0?parsed:0}
function cleanPhone(value){return normalizeDigits(value).replace(/[^\d+]/g,"")}
function due(job){return Math.max(0,(Number(job.price)||0)-(Number(job.paid)||0))}

function render(){
  const q=$("searchInput").value.trim().toLowerCase(),status=$("statusFilter").value;
  const filtered=jobs.filter(j=>(!status||j.status===status)&&(!q||[j.number,j.customer,j.phone,j.device,j.serial].join(" ").toLowerCase().includes(q)));
  $("jobs").replaceChildren(...filtered.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(card));
  $("empty").hidden=jobs.length>0; $("jobs").hidden=jobs.length===0;
  $("todayCount").textContent=jobs.filter(j=>j.createdAt.slice(0,10)===todayKey()).length;
  $("activeCount").textContent=jobs.filter(j=>!["جاهز","تم التسليم"].includes(j.status)).length;
  $("readyCount").textContent=jobs.filter(j=>j.status==="جاهز").length;
  $("dueTotal").textContent=money(jobs.reduce((s,j)=>s+due(j),0));
}

function card(job){
  const node=$("jobTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.id=job.id; node.querySelector(".job-number").textContent=job.number;
  node.querySelector(".job-device").textContent=job.device; node.querySelector(".job-customer").textContent=`${job.customer} · ${job.phone}`;
  node.querySelector(".job-issue").textContent=job.issue; node.querySelector(".status-pill").textContent=job.status;
  node.querySelector(".job-price").textContent=money(job.price); node.querySelector(".job-due").textContent=money(due(job));
  node.addEventListener("click",e=>{const action=e.target.dataset.action;if(action)act(action,job)}); return node;
}

function openJob(job){
  $("jobForm").reset(); fields.forEach(k=>$(k).value=job?.[k]??(k==="status"?"تم الاستلام":""));
  if(!job){$("price").value=0;$("paid").value=0} $("dialogTitle").textContent=job?`تعديل ${job.number}`:"استلام جهاز جديد"; $("jobDialog").showModal();
}

function act(action,job){
  if(action==="edit")return openJob(job);
  if(action==="delete"){if(confirm(`حذف الطلب ${job.number}؟`)){jobs=jobs.filter(x=>x.id!==job.id);save()}return}
  if(action==="whatsapp"){
    const msg=`مرحباً ${job.customer}، تحديث طلب الصيانة ${job.number}\nالجهاز: ${job.device}\nالحالة: ${job.status}\nالمبلغ المتبقي: ${money(due(job))}`;
    window.open(`https://wa.me/${encodeURIComponent(cleanPhone(job.phone))}?text=${encodeURIComponent(msg)}`,"_blank","noopener"); return;
  }
  if(action==="print")printReceipt(job);
}

function printReceipt(job){
  const sheet=document.createElement("section");sheet.className="print-sheet";
  const rows=[["رقم الطلب",job.number],["العميل",job.customer],["الهاتف",job.phone],["الجهاز",job.device],["الرقم التسلسلي",job.serial||"—"],["العطل",job.issue],["الحالة",job.status],["السعر",money(job.price)],["المدفوع",money(job.paid)],["المتبقي",money(due(job))]];
  const h=document.createElement("h1");h.textContent="صلّحها — إيصال استلام";const table=document.createElement("table");
  rows.forEach(([a,b])=>{const tr=document.createElement("tr"),x=document.createElement("td"),y=document.createElement("td");x.textContent=a;y.textContent=b;tr.append(x,y);table.append(tr)});sheet.append(h,table);document.body.append(sheet);window.print();sheet.remove();
}

$("newJobBtn").addEventListener("click",()=>openJob());
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$("jobDialog").close()));
$("jobForm").addEventListener("submit",e=>{
  e.preventDefault(); if(!e.submitter||e.submitter.value!=="save")return;
  const values=Object.fromEntries(fields.map(k=>[k,$(k).value.trim()]));const old=jobs.find(j=>j.id===values.jobId);
  values.phone=cleanPhone(values.phone); values.price=numberValue(values.price); values.paid=numberValue(values.paid);
  const job={...old,...values,id:old?.id||crypto.randomUUID(),number:old?.number||nextNumber(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),price:Number(values.price)||0,paid:Number(values.paid)||0};
  jobs=old?jobs.map(j=>j.id===old.id?job:j):[...jobs,job];save();$("jobDialog").close();
});
$("searchInput").addEventListener("input",render);$("statusFilter").addEventListener("change",render);
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").hidden=false});
$("installBtn").addEventListener("click",async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installBtn").hidden=true}});
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js");render();
