-- CreateTable
CREATE TABLE "claim_balance_snapshots" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(173,18) NOT NULL,

    CONSTRAINT "claim_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_balance_snapshots_user_id_idx" ON "claim_balance_snapshots"("user_id");

-- CreateIndex
CREATE INDEX "claim_balance_snapshots_user_id_timestamp_idx" ON "claim_balance_snapshots"("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "claim_balance_snapshots_claim_id_timestamp_idx" ON "claim_balance_snapshots"("claim_id", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "claim_balance_snapshots_claim_id_timestamp_key" ON "claim_balance_snapshots"("claim_id", "timestamp");

-- AddForeignKey
ALTER TABLE "claim_balance_snapshots" ADD CONSTRAINT "claim_balance_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_balance_snapshots" ADD CONSTRAINT "claim_balance_snapshots_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
