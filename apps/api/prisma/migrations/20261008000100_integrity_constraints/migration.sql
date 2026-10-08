-- Integrity constraints Prisma's schema language can't express.
-- (CHECK constraints are invisible to Prisma's diff engine, so they won't be
-- dropped by future `prisma migrate dev` runs.)

ALTER TABLE "users"
  ADD CONSTRAINT "users_feed_radius_range" CHECK ("feedRadiusM" BETWEEN 2000 AND 5000);

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_single_target" CHECK (num_nonnulls("businessId", "providerId") = 1);

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_price_non_negative" CHECK ("pricePaise" IS NULL OR "pricePaise" >= 0),
  ADD CONSTRAINT "posts_counters_non_negative" CHECK ("likeCount" >= 0 AND "commentCount" >= 0);

ALTER TABLE "ad_campaigns"
  ADD CONSTRAINT "ad_budget_positive" CHECK ("budgetPaise" > 0),
  ADD CONSTRAINT "ad_spend_within_budget" CHECK ("spentPaise" >= 0 AND "spentPaise" <= "budgetPaise"),
  ADD CONSTRAINT "ad_radius_range" CHECK ("radiusM" BETWEEN 500 AND 10000),
  ADD CONSTRAINT "ad_window_valid" CHECK ("endAt" > "startAt");

ALTER TABLE "businesses"
  ADD CONSTRAINT "business_wallet_non_negative" CHECK ("walletPaise" >= 0);

-- A conversation pair is stored ordered so (A,B) and (B,A) can't both exist.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversation_ordered_pair" CHECK ("userAId" < "userBId");

ALTER TABLE "service_providers"
  ADD CONSTRAINT "provider_radius_range" CHECK ("serviceRadiusM" BETWEEN 500 AND 20000);

-- ─────────────────────────────────────────────────────────────────────────────
-- Location columns must never be NULL, but Prisma can't `create()` a row with a
-- required Unsupported column. So the columns are nullable for Prisma, and this
-- DEFERRED constraint trigger enforces NOT NULL at COMMIT: application code
-- inserts the row and sets its point inside the same transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assert_location_present() RETURNS trigger AS $$
DECLARE
  missing boolean;
BEGIN
  -- Re-read the row at commit time: NEW reflects the triggering statement, but a
  -- later UPDATE in the same transaction is what sets the point.
  -- (EXECUTE doesn't set FOUND, so select into a variable.)
  EXECUTE format('SELECT location IS NULL FROM %I WHERE id = $1', TG_TABLE_NAME) INTO missing USING NEW.id;
  IF missing THEN
    RAISE EXCEPTION 'location is required on %', TG_TABLE_NAME USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER posts_location_required AFTER INSERT OR UPDATE ON "posts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
CREATE CONSTRAINT TRIGGER addresses_location_required AFTER INSERT OR UPDATE ON "addresses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
CREATE CONSTRAINT TRIGGER societies_location_required AFTER INSERT OR UPDATE ON "societies"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
CREATE CONSTRAINT TRIGGER businesses_location_required AFTER INSERT OR UPDATE ON "businesses"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
CREATE CONSTRAINT TRIGGER service_providers_location_required AFTER INSERT OR UPDATE ON "service_providers"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
CREATE CONSTRAINT TRIGGER ad_campaigns_location_required AFTER INSERT OR UPDATE ON "ad_campaigns"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_location_present();
