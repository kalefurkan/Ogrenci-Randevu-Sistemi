const $ = (s) => document.querySelector(s);
const TK = "falcons_teacher_token_v1";
let token = null;
try { token = sessionStorage.getItem(TK); } catch {}

const auth = () => ({ Authorization: "Bearer " + token });

function logout() {
  token = null;
  try { sessionStorage.removeItem(TK); } catch {}
  $("#panel").classList.add("hidden"); $("#pwchange").classList.add("hidden"); $("#login").classList.remove("hidden");
}

$("#login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#l-err"); err.replaceChildren();
  try {
    const r = await api("/api/teacher/login", {
      method: "POST", body: JSON.stringify({ teacher: $("#l-teacher").value, password: $("#l-pass").value }),
    });
    token = r.token;
    try { sessionStorage.setItem(TK, token); } catch {}
    $("#l-pass").value = "";
    if (r.mustChange) showPwChange(); else load();
  } catch (e) { err.append(el("div", { class: "err", text: e.message })); }
});
function showPwChange() {
  $("#login").classList.add("hidden"); $("#panel").classList.add("hidden"); $("#pwchange").classList.remove("hidden");
  $("#pw1").focus();
}
$("#pw-cancel").onclick = () => { $("#pwchange").classList.add("hidden"); logout(); };
$("#pw-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#pw-err"); err.replaceChildren();
  const p1 = $("#pw1").value, p2 = $("#pw2").value;
  if (p1.length < 8) { err.append(el("div", { class: "err", text: "Şifre en az 8 karakter olmalı." })); return; }
  if (p1 !== p2) { err.append(el("div", { class: "err", text: "Şifreler aynı değil." })); return; }
  try {
    const r = await api("/api/teacher/password", { method: "POST", headers: auth(), body: JSON.stringify({ newPassword: p1 }) });
    token = r.token;
    try { sessionStorage.setItem(TK, token); } catch {}
    $("#pw1").value = ""; $("#pw2").value = "";
    $("#pwchange").classList.add("hidden");
    toast("Şifren güncellendi. Bundan sonra bu şifreyle giriş yapacaksın.", true);
    load();
  } catch (e) { err.append(el("div", { class: "err", text: e.message })); }
});
$("#logout").onclick = logout;
$("#refresh").onclick = load;

async function act(a, status) {
  let note = "";
  if (status === "rejected") { note = prompt("Öğrenciye iletilecek kısa not (isteğe bağlı):") ?? null; if (note === null) return; }
  if (status === "cancelled" && !confirm("Onaylı randevuyu iptal etmek istiyor musunuz?")) return;
  try {
    await api("/api/teacher/appointments/" + a.id, { method: "POST", headers: auth(), body: JSON.stringify({ status, note }) });
    toast(status === "approved" ? "Randevu onaylandı." : "Randevu güncellendi.", true);
    load();
  } catch (e) { toast(e.message); if (e.status === 401) logout(); }
}

async function actPart(p, status) {
  let note = "";
  if (status === "rejected") { note = prompt("Öğrenciye iletilecek kısa not (isteğe bağlı):") ?? null; if (note === null) return; }
  if (status === "cancelled" && !confirm("Bu öğrenciyi randevudan çıkarmak istiyor musunuz?")) return;
  try {
    await api("/api/teacher/participants/" + p.id, { method: "POST", headers: auth(), body: JSON.stringify({ status, note }) });
    toast(status === "approved" ? "Katılım onaylandı, randevu güncellendi." : "Katılım isteği güncellendi.", true);
    load();
  } catch (e) { toast(e.message); if (e.status === 401) logout(); }
}

function partRow(p) {
  const btns = [];
  if (p.status === "pending") {
    btns.push(el("button", { class: "btn ok sm", type: "button", onclick: () => actPart(p, "approved") }, "Katılımı onayla"));
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => actPart(p, "rejected") }, "Reddet"));
  } else if (p.status === "approved") {
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => actPart(p, "cancelled") }, "Çıkar"));
  }
  return el("div", { class: "note" },
    el("strong", { text: `${p.name} (${p.studentClass}${p.email ? " · " + p.email : ""}) ` }), el("span", { class: "badge " + p.status, text: STATUS[p.status] }),
    el("div", { text: p.reason }),
    p.teacherNote ? el("div", { class: "meta", text: "Not: " + p.teacherNote }) : null,
    btns.length ? el("div", { class: "row", style: "margin-top:6px" }, ...btns) : null);
}

function card(a) {
  const btns = [];
  if (a.status === "pending") {
    btns.push(el("button", { class: "btn ok sm", type: "button", onclick: () => act(a, "approved") }, "Onayla"));
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => act(a, "rejected") }, "Reddet"));
  } else if (a.status === "approved") {
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => act(a, "cancelled") }, "İptal et"));
  }
  const parts = (a.participants || []).filter((p) => ["pending", "approved"].includes(p.status));
  const done = (a.participants || []).filter((p) => !["pending", "approved"].includes(p.status));
  const approved = parts.filter((p) => p.status === "approved");
  return el("div", { class: "appt " + a.status },
    el("div", { class: "top" },
      el("strong", { text: `${fmtDate(a.date)} · ${fmtRange(a.time, a.endTime)}` }),
      el("span", { class: "badge " + a.status, text: STATUS[a.status] })),
    el("div", { class: "meta", text: `${a.studentName} · ${a.studentClass}${a.studentEmail ? " · " + a.studentEmail : ""}` }),
    el("p", { text: a.reason }),
    a.teacherNote ? el("div", { class: "note", text: "Not: " + a.teacherNote }) : null,
    approved.length ? el("div", { class: "note" }, el("strong", { text: "Katılanlar: " }), approved.map((p) => `${p.name} (${p.studentClass})`).join(", ")) : null,
    parts.length ? el("h4", { style: "margin:10px 0 4px", text: "Katılım istekleri" }) : null,
    ...parts.map(partRow),
    done.length ? el("div", { class: "meta", style: "margin-top:8px", text: "Sonlanan istekler: " + done.map((p) => `${p.name} (${STATUS[p.status]})`).join(", ") }) : null,
    btns.length ? el("div", { class: "row", style: "margin-top:10px" }, ...btns) : null
  );
}

function section(title, items, emptyText) {
  return el("div", {}, el("h2", { class: "day-head", text: title + ` (${items.length})` }),
    items.length ? items.map(card) : el("div", { class: "empty", text: emptyText }));
}

async function load() {
  if (!token) return logout();
  try {
    const r = await api("/api/teacher/appointments", { headers: auth() });
    $("#login").classList.add("hidden"); $("#panel").classList.remove("hidden");
    $("#who").textContent = r.teacherName;
    const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    const A = r.appointments;
    const hasPendingJoin = (a) => (a.participants || []).some((p) => p.status === "pending");
    const pending = A.filter((a) => a.status === "pending" || (a.status === "approved" && a.date >= today && hasPendingJoin(a)));
    const upcoming = A.filter((a) => a.status === "approved" && a.date >= today);
    const past = A.filter((a) => !pending.includes(a) && !upcoming.includes(a)).reverse();
    $("#lists").replaceChildren(
      section("Onay bekleyenler (randevu / katılım isteği)", pending, "Bekleyen talep yok."),
      section("Onaylı yaklaşan randevular", upcoming, "Yaklaşan onaylı randevu yok."),
      section("Geçmiş / sonlanmış", past, "Kayıt yok.")
    );
  } catch (e) {
    if (e.status === 403) showPwChange();
    else if (e.status === 401) logout(); else toast(e.message);
  }
}

if (token) load();
// Panel açıkken yeni talepler için 60 sn'de bir yenile
setInterval(() => { if (token && !document.hidden) load(); }, 60000);
