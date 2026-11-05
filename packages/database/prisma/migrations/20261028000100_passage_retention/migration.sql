-- Persistent deletion journal AND tombstone. Completed keys must never be reused.
CREATE TABLE "RetentionImageDeletion" (
  "objectId" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT
);
CREATE INDEX "RetentionImageDeletion_pending_idx" ON "RetentionImageDeletion" ("lastAttemptAt", "createdAt") WHERE "completedAt" IS NULL;

CREATE FUNCTION prevent_retired_image_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE column_name TEXT; new_key TEXT; old_key TEXT;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    new_key := to_jsonb(NEW) ->> column_name;
    old_key := NULL;
    IF TG_OP = 'UPDATE' THEN old_key := to_jsonb(OLD) ->> column_name; END IF;
    IF new_key IS NOT NULL AND new_key IS DISTINCT FROM old_key
       AND EXISTS (SELECT 1 FROM "RetentionImageDeletion" WHERE "objectId" = new_key) THEN
      RAISE EXCEPTION 'Image object retired by retention' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER passage_retired_image BEFORE INSERT OR UPDATE ON "Passage" FOR EACH ROW
EXECUTE FUNCTION prevent_retired_image_reference('vehicleImage1ObjectId', 'vehicleImage2ObjectId', 'plateImageObjectId');
CREATE TRIGGER detection_retired_image BEFORE INSERT OR UPDATE ON "PlateDetection" FOR EACH ROW
EXECUTE FUNCTION prevent_retired_image_reference('frameObjectId');
CREATE TRIGGER hit_retired_image BEFORE INSERT OR UPDATE ON "Hit" FOR EACH ROW
EXECUTE FUNCTION prevent_retired_image_reference('vehicleImageObjectId', 'plateImageObjectId');
CREATE TRIGGER camera_retired_image BEFORE INSERT OR UPDATE ON "Camera" FOR EACH ROW
EXECUTE FUNCTION prevent_retired_image_reference('lastSnapshotObjectId');
