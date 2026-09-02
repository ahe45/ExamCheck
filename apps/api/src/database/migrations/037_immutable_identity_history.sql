CREATE TRIGGER trg_form_template_immutable_version
BEFORE UPDATE ON form_template
FOR EACH ROW
BEGIN
  IF OLD.lifecycle_state IN ('PUBLISHED', 'ARCHIVED') THEN
    IF NOT (
      OLD.lifecycle_state = 'PUBLISHED'
      AND OLD.active = TRUE
      AND NEW.lifecycle_state = 'ARCHIVED'
      AND NEW.active = FALSE
      AND NEW.id <=> OLD.id
      AND NEW.code <=> OLD.code
      AND NEW.version <=> OLD.version
      AND NEW.name <=> OLD.name
      AND NEW.description <=> OLD.description
      AND NEW.category <=> OLD.category
      AND NEW.usage_scope <=> OLD.usage_scope
      AND NEW.layout_json <=> OLD.layout_json
      AND NEW.created_by <=> OLD.created_by
      AND NEW.created_at <=> OLD.created_at
      AND NEW.published_by <=> OLD.published_by
      AND NEW.published_at <=> OLD.published_at
      AND NEW.supersedes_id <=> OLD.supersedes_id
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published and archived form_template versions are immutable';
    END IF;
  END IF;
END;

CREATE TRIGGER trg_form_template_immutable_delete
BEFORE DELETE ON form_template
FOR EACH ROW
BEGIN
  IF OLD.lifecycle_state IN ('PUBLISHED', 'ARCHIVED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published and archived form_template versions cannot be deleted';
  END IF;
END;

CREATE TRIGGER trg_pseudonym_operation_event_no_update
BEFORE UPDATE ON pseudonym_operation_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pseudonym_operation_event is append-only';

CREATE TRIGGER trg_pseudonym_operation_event_no_delete
BEFORE DELETE ON pseudonym_operation_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pseudonym_operation_event is append-only';

CREATE TRIGGER trg_pseudonym_assignment_event_no_update
BEFORE UPDATE ON pseudonym_assignment_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pseudonym_assignment_event is append-only';

CREATE TRIGGER trg_pseudonym_assignment_event_no_delete
BEFORE DELETE ON pseudonym_assignment_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pseudonym_assignment_event is append-only';

CREATE TRIGGER trg_legacy_pseudonym_reservation_no_update
BEFORE UPDATE ON legacy_pseudonym_reservation
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'legacy_pseudonym_reservation is immutable';

CREATE TRIGGER trg_legacy_pseudonym_reservation_no_delete
BEFORE DELETE ON legacy_pseudonym_reservation
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'legacy_pseudonym_reservation is immutable';

CREATE TRIGGER trg_print_projection_snapshot_no_update
BEFORE UPDATE ON print_projection_snapshot
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'print_projection_snapshot is immutable';

CREATE TRIGGER trg_print_projection_snapshot_no_delete
BEFORE DELETE ON print_projection_snapshot
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'print_projection_snapshot is immutable';
