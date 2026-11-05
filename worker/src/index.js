// Falcons Takımları Randevu Sistemi - API (Cloudflare Worker + D1)

const SLOT_MINUTES = 15;      // Her randevunun süresi
const HORIZON_DAYS = 14;      // Bugünden itibaren kaç gün ilerisi için randevu alınabilir
const MAX_ACTIVE_PER_STUDENT = 2;

// Gün numaraları: 0=Pazar, 1=Pazartesi ... 6=Cumartesi
const TEACHERS = {
  furkan: {
    name: "Furkan KALE",
    hours: {
      1: ["09:00", "13:00"],
      2: ["09:00", "10:50"],
      4: ["10:35", "12:45"],
      5: ["14:25", "15:50"],
    },
  },
  mustafa: {
    name: "Mustafa Demirkıran",
    hours: {
      2: ["08:00", "13:45"],
      3: ["12:00", "16:00"],
      5: ["13:45", "15:50"],
    },
  },
};

const DAY_NAMES = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (n) => String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");

// Türkiye saati (UTC+3, yaz/kış saati yok)
function nowTR() { return new Date(Date.now() + 3 * 3600 * 1000); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function dayOfWeek(dateStr) { return new Date(dateStr + "T00:00:00Z").getUTCDay(); }

function slotsFor(teacherKey, dateStr) {
  const t = TEACHERS[teacherKey];
  const h = t && t.hours[dayOfWeek(dateStr)];
  if (!h) return [];
  const out = [];
  for (let m = toMin(h[0]); m + SLOT_MINUTES <= toMin(h[1]); m += SLOT_MINUTES) out.push(fromMin(m));
  return out;
}

function horizonDates() {
  const base = nowTR();
  const dates = [];
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    dates.push(isoDate(d));
  }
  return dates;
}

function isPast(dateStr, time) {
  const n = nowTR();
  const today = isoDate(n);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return toMin(time) <= n.getUTCHours() * 60 + n.getUTCMinutes();
}

// ---------- yardımcılar ----------
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const h = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(env, teacher) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ t: teacher, exp: Date.now() + 12 * 3600 * 1000 })));
  return payload + "." + (await hmac(env.TOKEN_SECRET, payload));
}

async function requireTeacher(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !env.TOKEN_SECRET) throw new HttpError(401, "Oturum gerekli.");
  if (!safeEqual(sig, await hmac(env.TOKEN_SECRET, payload))) throw new HttpError(401, "Geçersiz oturum.");
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  } catch { throw new HttpError(401, "Geçersiz oturum."); }
  if (!data.exp || data.exp < Date.now() || !TEACHERS[data.t]) throw new HttpError(401, "Oturum süresi doldu.");
  return data.t;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function publicView(r) {
  return {
    code: r.code,
    teacher: r.teacher,
    teacherName: TEACHERS[r.teacher]?.name,
    date: r.date,
    time: r.time,
    studentName: r.student_name,
    studentClass: r.student_class,
    reason: r.reason,
    status: r.status,
    teacherNote: r.teacher_note || "",
    updatedAt: r.updated_at,
  };
}

// ---------- uç noktalar ----------
async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const cors = corsHeaders(request, env);

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // Program bilgisi
  if (path === "/api/schedule" && method === "GET") {
    const teachers = Object.entries(TEACHERS).map(([key, t]) => ({
      key,
      name: t.name,
      days: [1, 2, 3, 4, 5].map((d) => ({
        day: d,
        dayName: DAY_NAMES[d],
        hours: t.hours[d] ? t.hours[d][0] + " - " + t.hours[d][1] : null,
      })),
    }));
    return json({ slotMinutes: SLOT_MINUTES, teachers }, 200, cors);
  }

  // Bir öğretmenin uygun saatleri
  if (path === "/api/availability" && method === "GET") {
    const teacher = url.searchParams.get("teacher") || "";
    if (!TEACHERS[teacher]) throw new HttpError(400, "Öğretmen bulunamadı.");
    const dates = horizonDates();
    const { results } = await env.DB.prepare(
      "SELECT date, time FROM appointments WHERE teacher = ? AND date >= ? AND date <= ? AND status IN ('pending','approved')"
    ).bind(teacher, dates[0], dates[dates.length - 1]).all();
    const taken = new Set(results.map((r) => r.date + " " + r.time));
    const days = [];
    for (const date of dates) {
      const slots = slotsFor(teacher, date);
      if (!slots.length) continue;
      const list = slots
        .filter((time) => !isPast(date, time))
        .map((time) => ({ time, available: !taken.has(date + " " + time) }));
      if (list.length) days.push({ date, dayName: DAY_NAMES[dayOfWeek(date)], slots: list });
    }
    return json({ teacher, teacherName: TEACHERS[teacher].name, slotMinutes: SLOT_MINUTES, days }, 200, cors);
  }

  // Randevu oluştur
  if (path === "/api/appointments" && method === "POST") {
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const teacher = clean(b.teacher, 20);
    const date = clean(b.date, 10);
    const time = clean(b.time, 5);
    const name = clean(b.name, 60);
    const cls = clean(b.studentClass, 20);
    const reason = clean(b.reason, 500);

    if (!TEACHERS[teacher]) throw new HttpError(400, "Öğretmen seçmelisiniz.");
    if (name.split(" ").length < 2 || name.length < 5) throw new HttpError(400, "Lütfen ad ve soyadınızı eksiksiz yazın.");
    if (!cls) throw new HttpError(400, "Sınıf bilgisi zorunludur.");
    if (reason.length < 5) throw new HttpError(400, "Randevu nedenini kısaca yazın.");
    if (!horizonDates().includes(date) || !slotsFor(teacher, date).includes(time) || isPast(date, time))
      throw new HttpError(400, "Seçilen saat uygun değil.");

    const same = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM appointments WHERE lower(student_name) = lower(?) AND lower(student_class) = lower(?) AND status IN ('pending','approved') AND date >= ?"
    ).bind(name, cls, isoDate(nowTR())).first();
    if (same.n >= MAX_ACTIVE_PER_STUDENT)
      throw new HttpError(429, "Aynı anda en fazla " + MAX_ACTIVE_PER_STUDENT + " aktif randevunuz olabilir.");

    const now = new Date().toISOString();
    const code = newCode();
    try {
      await env.DB.prepare(
        "INSERT INTO appointments (id, code, teacher, date, time, student_name, student_class, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)"
      ).bind(crypto.randomUUID(), code, teacher, date, time, name, cls, reason, now, now).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new HttpError(409, "Bu saat az önce başkası tarafından alındı. Lütfen başka bir saat seçin.");
      throw e;
    }
    return json({ code }, 201, cors);
  }

  // Öğrenci: randevu durumu
  let m = path.match(/^\/api\/appointments\/([A-Z0-9]{8})$/i);
  if (m && method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM appointments WHERE code = ?").bind(m[1].toUpperCase()).first();
    if (!r) throw new HttpError(404, "Bu koda ait randevu bulunamadı.");
    return json(publicView(r), 200, cors);
  }

  // Öğrenci: iptal
  m = path.match(/^\/api\/appointments\/([A-Z0-9]{8})\/cancel$/i);
  if (m && method === "POST") {
    const r = await env.DB.prepare("SELECT * FROM appointments WHERE code = ?").bind(m[1].toUpperCase()).first();
    if (!r) throw new HttpError(404, "Randevu bulunamadı.");
    if (!["pending", "approved"].includes(r.status)) throw new HttpError(400, "Bu randevu zaten sonlanmış.");
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), r.id).run();
    return json({ ok: true }, 200, cors);
  }

  // Öğretmen girişi
  if (path === "/api/teacher/login" && method === "POST") {
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const teacher = clean(b.teacher, 20);
    const password = String(b.password ?? "");
    const secret = teacher === "furkan" ? env.FURKAN_PASSWORD : teacher === "mustafa" ? env.MUSTAFA_PASSWORD : null;
    if (!secret || !env.TOKEN_SECRET || !safeEqual(password, secret)) {
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, "Öğretmen veya şifre hatalı.");
    }
    return json({ token: await makeToken(env, teacher), teacher, teacherName: TEACHERS[teacher].name }, 200, cors);
  }

  // Öğretmen: randevu listesi
  if (path === "/api/teacher/appointments" && method === "GET") {
    const teacher = await requireTeacher(request, env);
    const from = isoDate(new Date(nowTR().getTime() - 7 * 86400000));
    const { results } = await env.DB.prepare(
      "SELECT * FROM appointments WHERE teacher = ? AND date >= ? ORDER BY date, time"
    ).bind(teacher, from).all();
    return json({ teacherName: TEACHERS[teacher].name, appointments: results.map(publicView).map((v, i) => ({ ...v, id: results[i].id })) }, 200, cors);
  }

  // Öğretmen: onayla / reddet / iptal
  m = path.match(/^\/api\/teacher\/appointments\/([0-9a-f-]{36})$/);
  if (m && method === "POST") {
    const teacher = await requireTeacher(request, env);
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const status = clean(b.status, 20);
    if (!["approved", "rejected", "cancelled"].includes(status)) throw new HttpError(400, "Geçersiz durum.");
    const note = clean(b.note, 300);
    const r = await env.DB.prepare("SELECT * FROM appointments WHERE id = ? AND teacher = ?").bind(m[1], teacher).first();
    if (!r) throw new HttpError(404, "Randevu bulunamadı.");
    await env.DB.prepare("UPDATE appointments SET status = ?, teacher_note = ?, updated_at = ? WHERE id = ?")
      .bind(status, note || null, new Date().toISOString(), r.id).run();
    return json({ ok: true }, 200, cors);
  }

  throw new HttpError(404, "Bulunamadı.");
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      const cors = corsHeaders(request, env);
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e);
      return json({ error: "Sunucu hatası." }, 500, cors);
    }
  },
};
