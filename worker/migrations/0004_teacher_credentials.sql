-- Öğretmenlerin kendi belirlediği şifreler (PBKDF2 özeti; düz şifre saklanmaz)
CREATE TABLE IF NOT EXISTS teacher_credentials (
  teacher TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
