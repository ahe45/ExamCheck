ALTER TABLE pseudonym_setting
  MODIFY COLUMN assignment_method ENUM('DRAW', 'SEQUENTIAL', 'MATCHING', 'PREASSIGNED') NOT NULL DEFAULT 'DRAW',
  ADD COLUMN print_preassigned_label BOOLEAN NOT NULL DEFAULT TRUE AFTER assignment_method;
