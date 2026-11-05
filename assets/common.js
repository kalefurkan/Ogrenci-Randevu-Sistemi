// Ortak yardımcılar
const API = window.API_BASE;

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    throw new Error("Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.");
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || "Bir hata oluştu."); e.status = res.status; throw e; }
  return data;
}

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}

const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const DAYS = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d} ${MONTHS[m - 1]} ${y}, ${DAYS[dow]}`;
}
const STATUS = { pending: "Onay bekliyor", approved: "Onaylandı", rejected: "Reddedildi", cancelled: "İptal edildi" };

function toast(msg, good) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) { wrap = el("div", { class: "toast-wrap", "aria-live": "polite" }); document.body.append(wrap); }
  const t = el("div", { class: "toast" + (good ? " good" : ""), text: msg });
  wrap.append(t);
  setTimeout(() => t.remove(), 9000);
}

function notify(title, body) {
  toast(title + " — " + body, true);
  try {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(title, { body, icon: "assets/logo.jpg" });
  } catch {}
}
