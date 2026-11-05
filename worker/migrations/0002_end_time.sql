-- Randevular artık bir saat aralığı (time = başlangıç, end_time = bitiş) kapsar.
ALTER TABLE appointments ADD COLUMN end_time TEXT;

UPDATE appointments SET end_time = printf('%02d:%02d',
  (CAST(substr(time,1,2) AS INTEGER) * 60 + CAST(substr(time,4,2) AS INTEGER) + 15) / 60,
  (CAST(substr(time,1,2) AS INTEGER) * 60 + CAST(substr(time,4,2) AS INTEGER) + 15) % 60)
WHERE end_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_overlap ON appointments (teacher, date, status, time, end_time);
