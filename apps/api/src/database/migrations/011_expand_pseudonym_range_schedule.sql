ALTER TABLE pseudonym_time_range
  ADD KEY ix_pseudonym_time_range_setting_id (setting_id),
  DROP INDEX uq_pseudonym_time_range_schedule,
  ADD COLUMN period_name VARCHAR(100) NOT NULL DEFAULT '' AFTER exam_time,
  ADD COLUMN admission VARCHAR(200) NOT NULL DEFAULT '' AFTER period_name,
  ADD COLUMN unit_name VARCHAR(200) NOT NULL DEFAULT '' AFTER admission,
  ADD COLUMN major VARCHAR(200) NOT NULL DEFAULT '' AFTER unit_name,
  ADD COLUMN building_name VARCHAR(200) NOT NULL DEFAULT '' AFTER major,
  ADD COLUMN room_name VARCHAR(200) NOT NULL DEFAULT '' AFTER building_name,
  ADD COLUMN schedule_key CHAR(64) NULL AFTER room_name;

UPDATE pseudonym_time_range
SET schedule_key = SHA2(CONCAT_WS('|', DATE_FORMAT(exam_date, '%Y-%m-%d'), exam_time,
  period_name, admission, unit_name, major, building_name, room_name), 256);

ALTER TABLE pseudonym_time_range
  MODIFY COLUMN schedule_key CHAR(64) NOT NULL,
  ADD UNIQUE KEY uq_pseudonym_time_range_schedule_key (setting_id, schedule_key);
