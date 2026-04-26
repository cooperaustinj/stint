ALTER TABLE entries ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'tracking'));
ALTER TABLE entries ADD COLUMN calculated_duration_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries ADD COLUMN duration_override_minutes INTEGER;

UPDATE entries
SET status = 'completed',
    calculated_duration_minutes = duration_minutes,
    duration_override_minutes = NULL
WHERE 1 = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_single_tracking
ON entries(status)
WHERE status = 'tracking' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
