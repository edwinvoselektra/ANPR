-- Herstel uitsluitend waarden die door de Fase 3 null->Date coercion-bug exact als
-- Unix epoch zijn opgeslagen. NULL betekent: geen begin/einde van de geldigheid.
UPDATE "PlateGroupMember"
SET "validFrom" = NULL
WHERE "validFrom" = TIMESTAMP '1970-01-01 00:00:00';

UPDATE "PlateGroupMember"
SET "validUntil" = NULL
WHERE "validUntil" = TIMESTAMP '1970-01-01 00:00:00';
