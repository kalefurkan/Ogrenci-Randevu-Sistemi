CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  teacher TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  teacher_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Aynı öğretmen/gün/saat için yalnızca bir aktif (bekleyen veya onaylı) randevu olabilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
  ON appointments (teacher, date, time)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_teacher_date ON appointments (teacher, date, time);
