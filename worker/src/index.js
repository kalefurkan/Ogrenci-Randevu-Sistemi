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

async function pbkdf2(password, saltB64) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}

async function makeToken(env, teacher, mustChange) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ t: teacher, mc: mustChange ? 1 : 0, exp: Date.now() + 12 * 3600 * 1000 })));
  return payload + "." + (await hmac(env.TOKEN_SECRET, payload));
}

async function requireTeacher(request, env, allowMustChange) {
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
  if (data.mc && !allowMustChange) throw new HttpError(403, "Önce yeni şifre belirlemelisiniz.");
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
    endTime: r.end_time || fromMin(toMin(r.time) + SLOT_MINUTES),
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
      "SELECT id, date, time, end_time, student_name, student_class, status FROM appointments WHERE teacher = ? AND date >= ? AND date <= ? AND status IN ('pending','approved')"
    ).bind(teacher, dates[0], dates[dates.length - 1]).all();
    const parts = await env.DB.prepare(
      `SELECT p.appointment_id, p.student_name, p.student_class FROM participants p
       JOIN appointments a ON a.id = p.appointment_id
       WHERE a.teacher = ? AND a.date >= ? AND a.date <= ? AND a.status IN ('pending','approved') AND p.status = 'approved'`
    ).bind(teacher, dates[0], dates[dates.length - 1]).all();
    const endOf = (r) => r.end_time || fromMin(toMin(r.time) + SLOT_MINUTES);
    const days = [];
    for (const date of dates) {
      const slots = slotsFor(teacher, date);
      if (!slots.length) continue;
      const booked = results.filter((r) => r.date === date);
      const findBooking = (time) => booked.find((r) => r.time <= time && time < endOf(r));
      const list = slots
        .filter((time) => !isPast(date, time))
        .map((time) => {
          const bk = findBooking(time);
          return bk ? { time, available: false, bookingId: bk.id } : { time, available: true };
        });
      const bookings = booked.map((r) => ({
        id: r.id, time: r.time, endTime: endOf(r), studentName: r.student_name, studentClass: r.student_class,
        status: r.status, past: isPast(date, r.time),
        participants: parts.results.filter((p) => p.appointment_id === r.id).map((p) => ({ name: p.student_name, studentClass: p.student_class })),
      }));
      if (list.length) days.push({ date, dayName: DAY_NAMES[dayOfWeek(date)], slots: list, bookings });
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
    const endTime = clean(b.endTime, 5);
    const name = clean(b.name, 60);
    const cls = clean(b.studentClass, 20);
    const reason = clean(b.reason, 500);

    if (!TEACHERS[teacher]) throw new HttpError(400, "Öğretmen seçmelisiniz.");
    if (name.split(" ").length < 2 || name.length < 5) throw new HttpError(400, "Lütfen ad ve soyadınızı eksiksiz yazın.");
    if (!cls) throw new HttpError(400, "Sınıf bilgisi zorunludur.");
    if (reason.length < 5) throw new HttpError(400, "Randevu nedenini kısaca yazın.");
    if (!horizonDates().includes(date) || isPast(date, time)) throw new HttpError(400, "Seçilen saat uygun değil.");
    // Aralık: başlangıçtan bitişe kadar tüm 15 dk'lık dilimler öğretmenin çalışma saatinde olmalı
    const daySlots = slotsFor(teacher, date);
    const start = toMin(time), end = toMin(endTime || "99:99");
    if (!/^\d\d:\d\d$/.test(time) || !/^\d\d:\d\d$/.test(endTime) || end <= start || (end - start) % SLOT_MINUTES !== 0)
      throw new HttpError(400, "Saat aralığı geçersiz.");
    for (let m = start; m < end; m += SLOT_MINUTES)
      if (!daySlots.includes(fromMin(m))) throw new HttpError(400, "Seçilen saat aralığı öğretmenin çalışma saatleri dışında.");

    const same = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM appointments WHERE lower(student_name) = lower(?) AND lower(student_class) = lower(?) AND status IN ('pending','approved') AND date >= ?"
    ).bind(name, cls, isoDate(nowTR())).first();
    if (same.n >= MAX_ACTIVE_PER_STUDENT)
      throw new HttpError(429, "Aynı anda en fazla " + MAX_ACTIVE_PER_STUDENT + " aktif randevunuz olabilir.");

    const now = new Date().toISOString();
    const code = newCode();
    // Tek, atomik ifade: çakışan aktif randevu yoksa ekle
    let res;
    try {
      res = await env.DB.prepare(
        `INSERT INTO appointments (id, code, teacher, date, time, end_time, student_name, student_class, reason, status, created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,?,?, 'pending', ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM appointments
           WHERE teacher = ? AND date = ? AND status IN ('pending','approved') AND time < ? AND end_time > ?
         )`
      ).bind(crypto.randomUUID(), code, teacher, date, time, endTime, name, cls, reason, now, now,
             teacher, date, endTime, time).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) res = { meta: { changes: 0 } };
      else throw e;
    }
    if (!res.meta.changes) throw new HttpError(409, "Seçtiğiniz aralıktaki bir saat az önce başkası tarafından alındı. Lütfen başka bir aralık seçin.");
    return json({ code }, 201, cors);
  }

  // Katılım isteği oluştur
  let m = path.match(/^\/api\/appointments\/([0-9a-f-]{36})\/join$/);
  if (m && method === "POST") {
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const name = clean(b.name, 60), cls = clean(b.studentClass, 20), reason = clean(b.reason, 500);
    if (name.split(" ").length < 2 || name.length < 5) throw new HttpError(400, "Lütfen ad ve soyadınızı eksiksiz yazın.");
    if (!cls) throw new HttpError(400, "Sınıf bilgisi zorunludur.");
    if (reason.length < 5) throw new HttpError(400, "Katılma nedenini kısaca yazın.");
    const a = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(m[1]).first();
    if (!a || !["pending", "approved"].includes(a.status)) throw new HttpError(404, "Bu randevu artık geçerli değil.");
    if (isPast(a.date, a.time)) throw new HttpError(400, "Bu randevunun saati geçti.");
    const same = (n, c) => n.toLowerCase() === name.toLowerCase() && c.toLowerCase() === cls.toLowerCase();
    if (same(a.student_name, a.student_class)) throw new HttpError(400, "Bu randevu zaten sizin.");
    const { results: ex } = await env.DB.prepare(
      "SELECT student_name, student_class FROM participants WHERE appointment_id = ? AND status IN ('pending','approved')"
    ).bind(a.id).all();
    if (ex.some((p) => same(p.student_name, p.student_class))) throw new HttpError(409, "Bu randevu için zaten bir katılım isteğiniz var.");
    const now = new Date().toISOString();
    const code = newCode();
    await env.DB.prepare(
      "INSERT INTO participants (id, code, appointment_id, student_name, student_class, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?, 'pending', ?, ?)"
    ).bind(crypto.randomUUID(), code, a.id, name, cls, reason, now, now).run();
    return json({ code }, 201, cors);
  }

  // Öğrenci: durum (randevu kodu veya katılım kodu)
  m = path.match(/^\/api\/appointments\/([A-Z0-9]{8})$/i);
  if (m && method === "GET") {
    const code = m[1].toUpperCase();
    const r = await env.DB.prepare("SELECT * FROM appointments WHERE code = ?").bind(code).first();
    if (r) {
      const { results } = await env.DB.prepare(
        "SELECT student_name, student_class FROM participants WHERE appointment_id = ? AND status = 'approved' ORDER BY created_at"
      ).bind(r.id).all();
      const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM participants WHERE appointment_id = ? AND status = 'pending'").bind(r.id).first();
      return json({ ...publicView(r), kind: "owner", participants: results.map((p) => ({ name: p.student_name, studentClass: p.student_class })), pendingJoinCount: n }, 200, cors);
    }
    const p = await env.DB.prepare(
      `SELECT p.*, a.teacher, a.date, a.time, a.end_time, a.student_name AS owner_name, a.student_class AS owner_class, a.status AS appt_status
       FROM participants p JOIN appointments a ON a.id = p.appointment_id WHERE p.code = ?`
    ).bind(code).first();
    if (!p) throw new HttpError(404, "Bu koda ait randevu bulunamadı.");
    return json({ ...publicView(p), kind: "join", ownerName: p.owner_name, ownerClass: p.owner_class, appointmentStatus: p.appt_status }, 200, cors);
  }

  // Öğrenci: iptal (randevu veya katılım isteği)
  m = path.match(/^\/api\/appointments\/([A-Z0-9]{8})\/cancel$/i);
  if (m && method === "POST") {
    const code = m[1].toUpperCase();
    const now = new Date().toISOString();
    const r = await env.DB.prepare("SELECT * FROM appointments WHERE code = ?").bind(code).first();
    if (r) {
      if (!["pending", "approved"].includes(r.status)) throw new HttpError(400, "Bu randevu zaten sonlanmış.");
      await env.DB.batch([
        env.DB.prepare("UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, r.id),
        env.DB.prepare("UPDATE participants SET status = 'cancelled', teacher_note = 'Randevu sahibi randevuyu iptal etti.', updated_at = ? WHERE appointment_id = ? AND status IN ('pending','approved')").bind(now, r.id),
      ]);
      return json({ ok: true }, 200, cors);
    }
    const p = await env.DB.prepare("SELECT * FROM participants WHERE code = ?").bind(code).first();
    if (!p) throw new HttpError(404, "Randevu bulunamadı.");
    if (!["pending", "approved"].includes(p.status)) throw new HttpError(400, "Bu istek zaten sonlanmış.");
    await env.DB.prepare("UPDATE participants SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, p.id).run();
    return json({ ok: true }, 200, cors);
  }

  // Öğretmen girişi
  if (path === "/api/teacher/login" && method === "POST") {
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const teacher = clean(b.teacher, 20);
    const password = String(b.password ?? "");
    const initial = teacher === "furkan" ? env.FURKAN_PASSWORD : teacher === "mustafa" ? env.MUSTAFA_PASSWORD : null;
    if (!initial || !env.TOKEN_SECRET) throw new HttpError(401, "Öğretmen veya şifre hatalı.");
    const cred = await env.DB.prepare("SELECT salt, hash FROM teacher_credentials WHERE teacher = ?").bind(teacher).first();
    // Şifre belirlendikten sonra yalnızca güncel şifre geçerli; ilk şifre artık çalışmaz.
    const ok = cred ? safeEqual(await pbkdf2(password, cred.salt), cred.hash) : safeEqual(password, initial);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 600));
      throw new HttpError(401, "Öğretmen veya şifre hatalı.");
    }
    const mustChange = !cred;
    return json({ token: await makeToken(env, teacher, mustChange), teacher, teacherName: TEACHERS[teacher].name, mustChange }, 200, cors);
  }

  // Öğretmen: yeni şifre belirle (ilk girişte zorunlu)
  if (path === "/api/teacher/password" && method === "POST") {
    const teacher = await requireTeacher(request, env, true);
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const pw = String(b.newPassword ?? "");
    if (pw.length < 8) throw new HttpError(400, "Yeni şifre en az 8 karakter olmalı.");
    if (pw.length > 100) throw new HttpError(400, "Şifre çok uzun.");
    const initial = teacher === "furkan" ? env.FURKAN_PASSWORD : env.MUSTAFA_PASSWORD;
    if (safeEqual(pw, initial)) throw new HttpError(400, "Yeni şifre, ilk verilen şifreyle aynı olamaz.");
    const cred = await env.DB.prepare("SELECT salt, hash FROM teacher_credentials WHERE teacher = ?").bind(teacher).first();
    if (cred) {
      // Şifre zaten belirlenmişse eski şifre de istenir
      const cur = String(b.currentPassword ?? "");
      if (!safeEqual(await pbkdf2(cur, cred.salt), cred.hash)) throw new HttpError(401, "Mevcut şifre hatalı.");
    }
    const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await pbkdf2(pw, salt);
    await env.DB.prepare(
      "INSERT INTO teacher_credentials (teacher, salt, hash, updated_at) VALUES (?,?,?,?) ON CONFLICT(teacher) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, updated_at = excluded.updated_at"
    ).bind(teacher, salt, hash, new Date().toISOString()).run();
    return json({ token: await makeToken(env, teacher, false), teacherName: TEACHERS[teacher].name }, 200, cors);
  }

  // Öğretmen: randevu listesi
  if (path === "/api/teacher/appointments" && method === "GET") {
    const teacher = await requireTeacher(request, env);
    const from = isoDate(new Date(nowTR().getTime() - 7 * 86400000));
    const { results } = await env.DB.prepare(
      "SELECT * FROM appointments WHERE teacher = ? AND date >= ? ORDER BY date, time"
    ).bind(teacher, from).all();
    const { results: pr } = await env.DB.prepare(
      "SELECT p.* FROM participants p JOIN appointments a ON a.id = p.appointment_id WHERE a.teacher = ? AND a.date >= ? ORDER BY p.created_at"
    ).bind(teacher, from).all();
    const appointments = results.map((r) => ({
      ...publicView(r), id: r.id,
      participants: pr.filter((p) => p.appointment_id === r.id).map((p) => ({
        id: p.id, name: p.student_name, studentClass: p.student_class, reason: p.reason, status: p.status, teacherNote: p.teacher_note || "",
      })),
    }));
    return json({ teacherName: TEACHERS[teacher].name, appointments }, 200, cors);
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
    const now = new Date().toISOString();
    const stmts = [env.DB.prepare("UPDATE appointments SET status = ?, teacher_note = ?, updated_at = ? WHERE id = ?").bind(status, note || null, now, r.id)];
    if (status !== "approved") {
      stmts.push(env.DB.prepare(
        "UPDATE participants SET status = 'cancelled', teacher_note = 'Ana randevu iptal edildi veya reddedildi.', updated_at = ? WHERE appointment_id = ? AND status IN ('pending','approved')"
      ).bind(now, r.id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true }, 200, cors);
  }

  // Öğretmen: katılım isteğini onayla / reddet / çıkar
  m = path.match(/^\/api\/teacher\/participants\/([0-9a-f-]{36})$/);
  if (m && method === "POST") {
    const teacher = await requireTeacher(request, env);
    let b;
    try { b = await request.json(); } catch { throw new HttpError(400, "Geçersiz istek."); }
    const status = clean(b.status, 20);
    if (!["approved", "rejected", "cancelled"].includes(status)) throw new HttpError(400, "Geçersiz durum.");
    const note = clean(b.note, 300);
    const p = await env.DB.prepare(
      "SELECT p.id, a.status AS appt_status FROM participants p JOIN appointments a ON a.id = p.appointment_id WHERE p.id = ? AND a.teacher = ?"
    ).bind(m[1], teacher).first();
    if (!p) throw new HttpError(404, "İstek bulunamadı.");
    if (status === "approved" && !["pending", "approved"].includes(p.appt_status)) throw new HttpError(400, "Ana randevu geçerli değil.");
    await env.DB.prepare("UPDATE participants SET status = ?, teacher_note = ?, updated_at = ? WHERE id = ?")
      .bind(status, note || null, new Date().toISOString(), p.id).run();
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
