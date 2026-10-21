ALTER TABLE candidate_record
  ADD COLUMN answer_sheet VARCHAR(500) NOT NULL DEFAULT '' AFTER group_name;

ALTER TABLE IF EXISTS candidate_registration
  ADD COLUMN answer_sheet VARCHAR(500) NOT NULL DEFAULT '' AFTER group_name;
