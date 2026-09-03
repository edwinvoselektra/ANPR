-- Fase beheer/analyse: additief; bestaande kentekens, groepen, passages en hits blijven behouden.
ALTER TABLE "PlateGroup" ADD COLUMN "hitEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Bestaande groepen met voorbereide meldingen waren de bestaande signaleringsgroepen.
UPDATE "PlateGroup" SET "hitEnabled" = true WHERE "pushNotifications" = true;

CREATE TABLE "HitGroup" (
    "hitId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HitGroup_pkey" PRIMARY KEY ("hitId", "groupId")
);

-- Neem de bestaande primaire groep van iedere hit over in de nieuwe meervoudige koppeling.
INSERT INTO "HitGroup" ("hitId", "groupId", "reason")
SELECT "id", "groupId", "reason" FROM "Hit"
ON CONFLICT ("hitId", "groupId") DO NOTHING;

CREATE UNIQUE INDEX "Hit_passageId_key" ON "Hit"("passageId");
CREATE UNIQUE INDEX "PlateGroup_name_lower_key" ON "PlateGroup"(LOWER("name"));
CREATE INDEX "HitGroup_groupId_idx" ON "HitGroup"("groupId");
CREATE INDEX "Passage_location_timestamp_idx" ON "Passage"("location", "timestamp");
CREATE INDEX "Passage_direction_timestamp_idx" ON "Passage"("direction", "timestamp");
CREATE INDEX "PlateGroupMember_groupId_active_idx" ON "PlateGroupMember"("groupId", "active");

ALTER TABLE "HitGroup" ADD CONSTRAINT "HitGroup_hitId_fkey"
FOREIGN KEY ("hitId") REFERENCES "Hit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HitGroup" ADD CONSTRAINT "HitGroup_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "PlateGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
