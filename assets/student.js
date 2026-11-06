// Öğrenci tarafı
const $ = (s) => document.querySelector(s);
const state = { schedule: null, teacher: null, avail: null, date: null, time: null, end: null };
state.view = null; state.joinDone = null;

/* ---------- sekmeler ---------- */
function showTab(name) {
  const book = name === "book";
  $("#view-book").classList.toggle("hidden", !book);
  $("#view-mine").classList.toggle("hidden", book);
  $("#tab-book").setAttribute("aria-selected", book);
  $("#tab-mine").setAttribute("aria-selected", !book);
  if (!book) renderMine();
}
$("#tab-book").onclick = () => showTab("book");
$("#tab-mine").onclick = () => showTab("mine");

function setStep(n) {
  [...$("#steps").children].forEach((li, i) => {
    li.className = i + 1 < n ? "done" : i + 1 === n ? "on" : "";
  });
}

/* ---------- 1. öğretmen seçimi ---------- */
async function stepTeacher() {
  setStep(1);
  const body = $("#book-body");
  body.replaceChildren(el("div", { class: "empty", text: "Yükleniyor…" }));
  try {
    if (!state.schedule) state.schedule = await api("/api/schedule");
  } catch (e) { body.replaceChildren(el("div", { class: "err", text: e.message })); return; }

  const cards = state.schedule.teachers.map((t) =>
    el("button", { class: "teacher", type: "button", onclick: () => { state.teacher = t; stepTime(); } },
      el("h3", { text: t.name }),
      el("table", {}, ...t.days.map((d) =>
        el("tr", { class: d.hours ? "" : "closed" }, el("td", { text: d.dayName }), el("td", { text: d.hours || "Randevu kapalı" }))
      ))
    )
  );
  body.replaceChildren(
    el("div", { class: "card" },
      el("h2", { text: "Hangi öğretmenden randevu almak istiyorsun?" }),
      el("p", { class: "hint", text: "Bir öğretmen seç; çalışma saatlerine göre uygun zamanlar listelenecek." }),
      el("div", { class: "teachers" }, ...cards)
    )
  );
}

/* ---------- 2. gün ve saat ---------- */
async function stepTime() {
  setStep(2);
  state.date = null; state.time = null; state.end = null;
  const body = $("#book-body");
  body.replaceChildren(el("div", { class: "empty", text: "Uygun saatler yükleniyor…" }));
  try {
    state.avail = await api("/api/availability?teacher=" + state.teacher.key);
  } catch (e) { body.replaceChildren(el("div", { class: "err", text: e.message })); return; }
  renderTime();
}

function renderTime() {
  const body = $("#book-body");
  const days = state.avail.days;
  const back = el("button", { class: "btn ghost", type: "button", onclick: stepTeacher }, "← Geri");
  if (!days.length) {
    body.replaceChildren(el("div", { class: "card" }, el("div", { class: "empty", text: "Bu öğretmen için şu an uygun saat yok." }), back));
    return;
  }
  if (!state.date) state.date = (days.find((d) => d.slots.some((s) => s.available)) || days[0]).date;
  const day = days.find((d) => d.date === state.date);

  const chips = days.map((d) => {
    const [, m, dd] = d.date.split("-");
    return el("button", {
      class: "chip", type: "button", "aria-pressed": d.date === state.date,
      onclick: () => { state.date = d.date; state.time = null; state.end = null; state.view = null; renderTime(); },
    }, `${Number(dd)}.${m}`, el("small", { text: d.dayName }));
  });
  const slots = day.slots;
  const step = state.avail.slotMinutes;
  const iS = state.time ? slots.findIndex((s) => s.time === state.time) : -1;
  const iE = state.end ? slots.findIndex((s) => tmin(s.time) + step === tmin(state.end)) : -1;
  const times = slots.map((s, i) => {
    const inRange = iS >= 0 && i >= iS && i <= iE;
    const edge = inRange && (i === iS || i === iE);
    return el("button", {
      class: "time" + (inRange ? " sel" : "") + (edge ? " edge" : "") + (s.available ? "" : " taken") + (!s.available && s.bookingId === state.view ? " viewing" : ""),
      type: "button", "aria-pressed": inRange,
      title: s.available ? "" : "Dolu — kimin aldığını görmek için dokun",
      onclick: () => pickSlot(i),
    }, inRange ? "✓ " + s.time : s.time);
  });
  const hasSel = iS >= 0 && iE >= iS;
  const selBar = el("div", { class: "selbar" + (hasSel ? " on" : "") },
    hasSel
      ? [el("strong", { text: fmtRange(state.time, state.end) }), ` (${fmtDur(state.time, state.end)}) seçildi`]
      : "Başlangıç saatine, sonra bitiş saatine dokun. Tek saat için sadece bir kez dokunman yeterli.");
  const free = day.slots.filter((s) => s.available).length;

  body.replaceChildren(
    el("div", { class: "card" },
      el("h2", { text: state.teacher.name + " — gün ve saat seç" }),
      el("p", { class: "hint", text: `Bir saat aralığı seçebilirsin Önce başlangıç, sonra bitiş saatine dokun. Taralı saatler doludur; dokunursan randevuyu kimin aldığını görür, katılım isteği gönderebilirsin.` }),
      el("div", { class: "chips" }, ...chips),
      el("h3", { class: "day-head", text: fmtDate(state.date) + (free ? "" : " — bu gün tüm saatler dolu") }),
      el("div", { class: "times" }, ...times),
      selBar,
      state.view ? bookingPanel(day) : null,
      el("div", { class: "row" }, back,
        el("button", { class: "btn", type: "button", disabled: !hasSel, onclick: stepForm }, "Devam →"))
    )
  );
}

function pickSlot(i) {
  const slots = state.avail.days.find((d) => d.date === state.date).slots;
  const step = state.avail.slotMinutes;
  const iS = state.time ? slots.findIndex((s) => s.time === state.time) : -1;
  const iE = state.end ? slots.findIndex((s) => tmin(s.time) + step === tmin(state.end)) : -1;
  const single = iS >= 0 && iS === iE;
  if (!slots[i].available) { state.view = slots[i].bookingId; state.joinDone = null; renderTime(); return; }
  state.view = null;
  if (single && i > iS) {
    // aralığı genişlet: aradaki tüm saatler boş olmalı
    const between = slots.slice(iS, i + 1);
    const contiguous = between.every((s, k) => s.available && (k === 0 || tmin(s.time) - tmin(between[k - 1].time) === step));
    if (!contiguous) { toast("Seçtiğin aralıkta dolu bir saat var."); }
    else { state.end = fromEnd(slots[i].time, step); renderTime(); return; }
    return;
  }
  // yeni başlangıç
  state.time = slots[i].time; state.end = fromEnd(slots[i].time, step);
  renderTime();
}
function bookingPanel(day) {
  const bk = day.bookings.find((b) => b.id === state.view);
  if (!bk) return null;
  const parts = bk.participants.length
    ? el("p", {}, el("strong", { text: "Katılanlar: " }), bk.participants.map((p) => `${p.name} (${p.studentClass})`).join(", "))
    : null;
  const box = el("div", { class: "card booking" },
    el("h3", { style: "margin:0 0 6px", text: `Dolu: ${fmtRange(bk.time, bk.endTime)}` }),
    el("p", { style: "margin:0" }, el("strong", { text: "Randevuyu alan: " }), `${bk.studentName} (${bk.studentClass}) `,
      el("span", { class: "badge " + bk.status, text: STATUS[bk.status] })),
    parts
  );
  if (bk.past) { box.append(el("p", { class: "hint", text: "Bu randevunun saati geçti." })); return box; }
  if (state.joinDone && state.joinDone.id === bk.id) {
    box.append(
      el("p", { text: "Katılma isteğin öğretmene iletildi ✔ Onaylanırsa randevu bilgisi güncellenir. İstek kodun:" }),
      el("div", { class: "code-box", text: state.joinDone.code }),
      el("button", { class: "btn", type: "button", onclick: async () => { await askNotif(); showTab("mine"); } }, "Randevularım'a git"));
    return box;
  }
  const err = el("div");
  const name = el("input", { id: "j-name", maxlength: 60, autocomplete: "name", placeholder: "Ad Soyad" });
  const cls = el("input", { id: "j-cls", maxlength: 20, placeholder: "Örn: 10-A" });
  const reason = el("textarea", { id: "j-reason", maxlength: 500, placeholder: "Bu randevuya neden katılmak istiyorsun?" });
  const btn = el("button", { class: "btn", type: "submit" }, "Katılma isteği gönder");
  const form = el("form", { class: "joinform hidden", novalidate: true },
    el("label", { for: "j-name", text: "Ad Soyad" }), name,
    el("label", { for: "j-cls", text: "Sınıf" }), cls,
    el("label", { for: "j-reason", text: "Katılma nedeni" }), reason, err,
    el("div", { class: "row" }, btn));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); err.replaceChildren(); btn.disabled = true; btn.textContent = "Gönderiliyor…";
    try {
      const r = await api(`/api/appointments/${bk.id}/join`, { method: "POST", body: JSON.stringify({ name: name.value, studentClass: cls.value, reason: reason.value }) });
      saveCode(r.code); state.joinDone = { id: bk.id, code: r.code }; renderTime();
    } catch (e) { err.replaceChildren(el("div", { class: "err", text: e.message })); btn.disabled = false; btn.textContent = "Katılma isteği gönder"; }
  });
  box.append(
    el("div", { class: "row" }, el("button", { class: "btn", type: "button", onclick: (ev) => { form.classList.remove("hidden"); ev.target.classList.add("hidden"); name.focus(); } }, "Bu randevuya katılma isteği gönder")),
    form);
  return box;
}

function fromEnd(t, step) {
  const m = tmin(t) + step;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/* ---------- 3. bilgiler ---------- */
function stepForm() {
  setStep(3);
  const body = $("#book-body");
  const err = el("div");
  const name = el("input", { id: "f-name", required: true, maxlength: 60, autocomplete: "name", placeholder: "Ad Soyad" });
  const email = el("input", { id: "f-email", type: "email", required: true, maxlength: 100, autocomplete: "email", placeholder: "ornek@eposta.com" });
  const cls = el("input", { id: "f-cls", required: true, maxlength: 20, placeholder: "Örn: 10-A" });
  const reason = el("textarea", { id: "f-reason", required: true, maxlength: 500, placeholder: "Randevuyu neden almak istiyorsun?" });
  const submit = el("button", { class: "btn", type: "submit" }, "Randevu talebini gönder");

  const form = el("form", { class: "card", novalidate: true },
    el("h2", { text: "Bilgilerini gir" }),
    el("div", { class: "summary" },
      el("strong", { text: state.teacher.name }), " · ", fmtDate(state.date), " · ", el("strong", { text: fmtRange(state.time, state.end) })),
    el("label", { for: "f-name", text: "Ad Soyad" }), name,
    el("label", { for: "f-cls", text: "Sınıf" }), cls,
    el("label", { for: "f-email", text: "E-posta adresi" }), email,
    el("p", { class: "hint", style: "margin:4px 0 0", text: "Randevun onaylandığında bu adrese e-posta gelecek. Adresin yalnızca öğretmene gösterilir." }),
    el("label", { for: "f-reason", text: "Randevu nedeni" }), reason,
    err,
    el("div", { class: "row" },
      el("button", { class: "btn ghost", type: "button", onclick: renderTime }, "← Geri"), submit)
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err.replaceChildren();
    submit.disabled = true; submit.textContent = "Gönderiliyor…";
    try {
      const r = await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          teacher: state.teacher.key, date: state.date, time: state.time, endTime: state.end,
          name: name.value, studentClass: cls.value, email: email.value, reason: reason.value,
        }),
      });
      saveCode(r.code);
      success(r.code);
    } catch (e) {
      err.replaceChildren(el("div", { class: "err", text: e.message }));
      submit.disabled = false; submit.textContent = "Randevu talebini gönder";
      if (e.status === 409) { stepTime(); toast(e.message); }
    }
  });
  body.replaceChildren(form);
  name.focus();
}

function success(code) {
  $("#steps").classList.add("hidden");
  $("#book-body").replaceChildren(
    el("div", { class: "card" },
      el("h2", { text: "Talebin alındı ✔" }),
      el("p", { text: `${state.teacher.name} ile ${fmtDate(state.date)} saat ${fmtRange(state.time, state.end)} için randevu talebin onay bekliyor.` }),
      el("p", { class: "hint", text: "Randevu kodun (not al!):" }),
      el("div", { class: "code-box", text: code }),
      el("p", { class: "hint", text: "Talebin öğretmene e-postayla iletildi; onaylanınca e-posta adresine bilgi gelecek. Durumunu “Randevularım” sekmesinden takip edebilirsin. Onaylandığında bu sayfa açıksa bildirim gelir." }),
      el("div", { class: "row" },
        el("button", { class: "btn", type: "button", onclick: async () => { await askNotif(); showTab("mine"); } }, "Randevularım'a git"),
        el("button", { class: "btn ghost", type: "button", onclick: () => { $("#steps").classList.remove("hidden"); stepTeacher(); } }, "Yeni randevu"))
    )
  );
}

/* ---------- Randevularım + bildirim ---------- */
const KEY = "falcons_codes_v1";
const SEEN = "falcons_status_v1";
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function saveCode(code) {
  const codes = readJSON(KEY, []);
  if (!codes.includes(code)) writeJSON(KEY, [code, ...codes].slice(0, 20));
  const seen = readJSON(SEEN, {}); seen[code] = "pending"; writeJSON(SEEN, seen);
}

async function askNotif() {
  try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
  updateNotifBtn();
}
function updateNotifBtn() {
  const b = $("#notif-btn");
  if (!("Notification" in window)) { $("#notif-card").classList.add("hidden"); return; }
  const p = Notification.permission;
  b.textContent = p === "granted" ? "Bildirimler açık ✔" : p === "denied" ? "Tarayıcı ayarlarından izin verin" : "Bildirimlere izin ver";
  b.disabled = p !== "default";
}
$("#notif-btn").onclick = askNotif;

function apptCard(a, onCancel) {
  const active = a.status === "pending" || a.status === "approved";
  const join = a.kind === "join";
  return el("div", { class: "appt " + a.status },
    el("div", { class: "top" },
      el("strong", { text: `${join ? "Katılım isteği · " : ""}${a.teacherName} · ${fmtDate(a.date)} · ${fmtRange(a.time, a.endTime)}` }),
      el("span", { class: "badge " + a.status, text: STATUS[a.status] })),
    el("div", { class: "meta", text: `${a.studentName} (${a.studentClass}) · Kod: ${a.code}` }),
    join ? el("div", { class: "meta", text: `Randevu sahibi: ${a.ownerName} (${a.ownerClass})` }) : null,
    el("p", { text: a.reason }),
    !join && a.participants && a.participants.length
      ? el("div", { class: "note", text: "Katılanlar: " + a.participants.map((p) => `${p.name} (${p.studentClass})`).join(", ") }) : null,
    !join && a.pendingJoinCount ? el("div", { class: "note", text: `${a.pendingJoinCount} katılım isteği öğretmen onayında.` }) : null,
    a.teacherNote ? el("div", { class: "note", text: "Öğretmen notu: " + a.teacherNote }) : null,
    active ? el("div", { class: "row", style: "margin-top:10px" },
      el("button", { class: "btn ghost sm", type: "button", onclick: () => onCancel(a) }, join ? "İsteği geri çek" : "Randevuyu iptal et")) : null
  );
}

async function cancelAppt(a) {
  if (!confirm("Bu randevuyu iptal etmek istiyor musun?")) return;
  try { await api(`/api/appointments/${a.code}/cancel`, { method: "POST" }); toast("Randevu iptal edildi."); renderMine(); }
  catch (e) { toast(e.message); }
}

async function renderMine() {
  updateNotifBtn();
  const codes = readJSON(KEY, []);
  const box = $("#mine-list");
  if (!codes.length) { box.replaceChildren(); return; }
  const res = await Promise.all(codes.map((c) => api("/api/appointments/" + c).catch(() => null)));
  const list = res.filter(Boolean);
  box.replaceChildren(
    el("h2", { class: "day-head", text: "Bu cihazdaki randevuların" }),
    ...list.map((a) => apptCard(a, cancelAppt))
  );
}

$("#lookup").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const code = $("#lookup-code").value.trim().toUpperCase();
  const err = $("#lookup-err"); err.replaceChildren();
  if (code.length !== 8) { err.append(el("div", { class: "err", text: "Kod 8 karakter olmalı." })); return; }
  try {
    await api("/api/appointments/" + code);
    saveCode(code); $("#lookup-code").value = ""; renderMine();
  } catch (e) { err.append(el("div", { class: "err", text: e.message })); }
});

// Durum değişikliklerini 30 sn'de bir kontrol et; değişirse bildirim göster
async function poll() {
  const codes = readJSON(KEY, []);
  if (!codes.length) return;
  const seen = readJSON(SEEN, {});
  let changed = false;
  for (const c of codes) {
    const a = await api("/api/appointments/" + c).catch(() => null);
    if (!a) continue;
    if (seen[c] && seen[c] !== a.status && a.status !== "pending") {
      if (a.status === "approved" && a.kind === "join") notify("Katılım isteğin onaylandı ✔", `${a.teacherName} · ${fmtDate(a.date)} · ${fmtRange(a.time, a.endTime)}`);
      else if (a.status === "rejected" && a.kind === "join") notify("Katılım isteğin reddedildi", (a.teacherNote || "") + ` (${fmtRange(a.time, a.endTime)})`);
      else if (a.status === "approved") notify("Randevun onaylandı ✔", `${a.teacherName} · ${fmtDate(a.date)} · ${fmtRange(a.time, a.endTime)}`);
      else if (a.status === "rejected") notify("Randevun reddedildi", (a.teacherNote || "Başka bir saat seçebilirsin.") + ` (${fmtRange(a.time, a.endTime)})`);
      changed = true;
    }
    seen[c] = a.status;
  }
  writeJSON(SEEN, seen);
  if (changed && !$("#view-mine").classList.contains("hidden")) renderMine();
}
setInterval(() => { if (!document.hidden) poll(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

stepTeacher();
poll();
