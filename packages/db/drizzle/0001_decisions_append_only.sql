-- Decision records are append-only (spec §5.5): a correction is a new row that supersedes the old one.
CREATE OR REPLACE FUNCTION symbolon_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON "decisions"
  FOR EACH ROW EXECUTE FUNCTION symbolon_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER decision_anchors_append_only BEFORE DELETE ON "decision_anchors"
  FOR EACH ROW EXECUTE FUNCTION symbolon_reject_mutation();
