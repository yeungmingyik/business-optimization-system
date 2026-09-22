CREATE TABLE customer_drafts (user_id uuid PRIMARY KEY REFERENCES users(id), document jsonb, version integer NOT NULL DEFAULT 0 CHECK(version>=0), updated_at timestamptz NOT NULL DEFAULT now(), CHECK(document IS NULL OR jsonb_typeof(document)='object'));
ALTER TABLE payment_changes ADD COLUMN receiving_account text NOT NULL DEFAULT '' CHECK(length(receiving_account)<=200);
