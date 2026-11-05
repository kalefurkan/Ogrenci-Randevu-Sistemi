-- Dolu bir randevuya katılım istekleri
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  appointment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  teacher_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS idx_part_appt ON participants (appointment_id, status);
