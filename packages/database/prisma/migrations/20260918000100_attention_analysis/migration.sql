CREATE TYPE "AttentionConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "AttentionAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "PatternReviewLabel" AS ENUM ('NORMAL', 'ATTENTION', 'SUSPICIOUS_PATTERN', 'INSUFFICIENT_INFO');

CREATE TABLE "AttentionSnapshot" (
  "id" UUID NOT NULL,
  "passageId" UUID NOT NULL,
  "normalizedLicensePlate" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "confidence" "AttentionConfidence" NOT NULL,
  "factorsJson" JSONB NOT NULL,
  "reasonsJson" JSONB NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttentionSnapshot_score_check" CHECK ("score" >= 0 AND "score" <= 100)
);

CREATE TABLE "AttentionAnalysisJob" (
  "id" UUID NOT NULL,
  "passageId" UUID NOT NULL,
  "status" "AttentionAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttentionAnalysisJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatternReview" (
  "id" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "reviewLabel" "PatternReviewLabel" NOT NULL,
  "reviewedById" UUID NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatternReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttentionSnapshot_passageId_key" ON "AttentionSnapshot"("passageId");
CREATE INDEX "AttentionSnapshot_normalizedLicensePlate_calculatedAt_idx" ON "AttentionSnapshot"("normalizedLicensePlate", "calculatedAt");
CREATE INDEX "AttentionSnapshot_expiresAt_idx" ON "AttentionSnapshot"("expiresAt");
CREATE UNIQUE INDEX "AttentionAnalysisJob_passageId_key" ON "AttentionAnalysisJob"("passageId");
CREATE INDEX "AttentionAnalysisJob_status_availableAt_idx" ON "AttentionAnalysisJob"("status", "availableAt");
CREATE UNIQUE INDEX "PatternReview_snapshotId_key" ON "PatternReview"("snapshotId");
CREATE INDEX "PatternReview_reviewedById_reviewedAt_idx" ON "PatternReview"("reviewedById", "reviewedAt");
CREATE INDEX "Passage_normalizedLicensePlate_timestamp_idx" ON "Passage"("normalizedLicensePlate", "timestamp");

ALTER TABLE "AttentionSnapshot" ADD CONSTRAINT "AttentionSnapshot_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttentionAnalysisJob" ADD CONSTRAINT "AttentionAnalysisJob_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternReview" ADD CONSTRAINT "PatternReview_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AttentionSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternReview" ADD CONSTRAINT "PatternReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
