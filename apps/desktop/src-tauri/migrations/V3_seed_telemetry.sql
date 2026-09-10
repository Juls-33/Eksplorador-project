-- 1. Add missing plot and mission tracking columns
ALTER TABLE telemetry ADD COLUMN plot TEXT;
ALTER TABLE telemetry ADD COLUMN mission_id TEXT;

-- 2. Seed telemetry waypoints matching your database schema
INSERT INTO telemetry (mission_id, plot, moisture, ph, ec, nitrogen, phosphorus, potassium, latitude, longitude, timestamp) 
VALUES 
-- Plot 1: East Rice Paddy (MSN-002)
('MSN-001', 'East Rice Paddy', 42.5, 6.4, 1.20, 28, 24, 38, 14.6210, 121.0980, '2026-09-09 08:30:00'),
('MSN-001', 'East Rice Paddy', 40.1, 6.3, 1.18, 26, 22, 36, 14.6212, 121.0982, '2026-09-09 08:45:00'),
('MSN-001', 'East Rice Paddy', 44.8, 6.5, 1.25, 30, 25, 40, 14.6215, 121.0985, '2026-09-09 09:00:00'),
('MSN-001', 'East Rice Paddy', 41.2, 6.2, 1.15, 25, 21, 35, 14.6218, 121.0988, '2026-09-09 09:15:00'),

-- Plot 2: Highland Maize Block (MSN-003)
('MSN-002', 'Highland Maize Block', 22.5, 5.4, 0.85, 12, 14, 18, 14.6300, 121.1050, '2026-09-10 14:00:00'),
('MSN-002', 'Highland Maize Block', 24.0, 5.6, 0.90, 15, 15, 20, 14.6302, 121.1052, '2026-09-10 14:15:00'),
('MSN-002', 'Highland Maize Block', 21.0, 5.3, 0.80, 10, 12, 15, 14.6305, 121.1055, '2026-09-10 14:30:00'),
('MSN-002', 'Highland Maize Block', 23.2, 5.5, 0.88, 14, 16, 19, 14.6308, 121.1058, '2026-09-10 14:45:00');