const $ = (s) => document.querySelector(s);
const TK = "falcons_teacher_token_v1";
let token = null;
try { token = sessionStorage.getItem(TK); } catch {}

const auth = () => ({ Authorization: "Bearer " + token });

function logout() {
  token = null;
  try { sessionStorage.removeItem(TK); } catch {}
  $("#panel").classList.add("hidden"); $("#login").classList.remove("hidden");
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

function card(a) {
  const btns = [];
  if (a.status === "pending") {
    btns.push(el("button", { class: "btn ok sm", type: "button", onclick: () => act(a, "approved") }, "Onayla"));
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => act(a, "rejected") }, "Reddet"));
  } else if (a.status === "approved") {
    btns.push(el("button", { class: "btn ghost sm", type: "button", onclick: () => act(a, "cancelled") }, "İptal et"));
  }
  return el("div", { class: "appt " + a.status },
    el("div", { class: "top" },
      el("strong", { text: `${fmtDate(a.date)} · ${fmtRange(a.time, a.endTime)}` }),
      el("span", { class: "badge " + a.status, text: STATUS[a.status] })),
    el("div", { class: "meta", text: `${a.studentName} · ${a.studentClass}` }),
    el("p", { text: a.reason }),
    a.teacherNote ? el("div", { class: "note", text: "Not: " + a.teacherNote }) : null,
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
    const pending = A.filter((a) => a.status === "pending");
    const upcoming = A.filter((a) => a.status === "approved" && a.date >= today);
    const past = A.filter((a) => !pending.includes(a) && !upcoming.includes(a)).reverse();
    $("#lists").replaceChildren(
      section("Onay bekleyenler", pending, "Bekleyen talep yok."),
      section("Onaylı yaklaşan randevular", upcoming, "Yaklaşan onaylı randevu yok."),
      section("Geçmiş / sonlanmış", past, "Kayıt yok.")
    );
  } catch (e) {
    if (e.status === 401) logout(); else toast(e.message);
  }
}

if (token) load();
// Panel açıkken yeni talepler için 60 sn'de bir yenile
setInterval(() => { if (token && !document.hidden) load(); }, 60000);
