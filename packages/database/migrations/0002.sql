ALTER TABLE customers ADD COLUMN IF NOT EXISTS next_followup_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_deal_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS followup_status text;
CREATE OR REPLACE FUNCTION sync_customer_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.next_followup_at := (NEW.document->>'nextFollowupAt')::timestamptz;
  NEW.last_deal_at := (NEW.document->>'lastDealAt')::timestamptz;
  NEW.followup_status := NEW.document->>'status';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customers_sync_fields ON customers;
CREATE TRIGGER customers_sync_fields BEFORE INSERT OR UPDATE OF document ON customers FOR EACH ROW EXECUTE FUNCTION sync_customer_fields();
UPDATE customers SET document=document;
CREATE INDEX IF NOT EXISTS customers_owner_followup_time ON customers(owner_id,next_followup_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_owner_deal_time ON customers(owner_id,last_deal_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_global_followup_time ON customers(next_followup_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_global_deal_time ON customers(last_deal_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS customers_owner_status ON customers(owner_id,followup_status) WHERE archived_at IS NULL;
DROP INDEX IF EXISTS customers_followup;
DROP INDEX IF EXISTS customers_deal;
DROP INDEX IF EXISTS customers_status;
