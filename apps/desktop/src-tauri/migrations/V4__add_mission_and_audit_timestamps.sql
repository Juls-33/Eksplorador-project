-- Add mission reference and audit columns without non-constant DEFAULT expressions
ALTER TABLE telemetry ADD COLUMN mission_id INTEGER DEFAULT NULL;
ALTER TABLE telemetry ADD COLUMN created_at TEXT DEFAULT NULL;
ALTER TABLE telemetry ADD COLUMN updated_at TEXT DEFAULT NULL;

-- Populate existing rows with timestamps
UPDATE telemetry 
SET created_at = CURRENT_TIMESTAMP, 
    updated_at = CURRENT_TIMESTAMP 
WHERE created_at IS NULL;