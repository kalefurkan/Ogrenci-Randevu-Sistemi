# Falcons Takımları Randevu Sistemi

Öğrencilerin Furkan KALE ve Mustafa Demirkıran'dan randevu aldığı sistem.

- `index.html`, `teacher.html`, `assets/` — GitHub Pages'te yayınlanan arayüz
- `worker/` — Cloudflare Worker (API) + D1 veritabanı

Çalışma saatleri: `worker/src/index.js` içindeki `TEACHERS`. Değişince: `cd worker && npx wrangler deploy`.
Gerekli secret'lar: `FURKAN_PASSWORD`, `MUSTAFA_PASSWORD`, `TOKEN_SECRET`.
