export const transferSchema = `
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  document jsonb NOT NULL,
  current_version_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_versions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets(id),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  media_type text NOT NULL,
  bytes bigint NOT NULL,
  checksum text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_versions_asset_idx ON asset_versions(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_updated_idx ON assets(archived_at, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS assets_document_idx ON assets USING gin(document);
CREATE TABLE IF NOT EXISTS transfer_jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('IMPORT', 'EXPORT')),
  kind text NOT NULL CHECK (kind IN ('customers', 'products', 'orders')),
  actor_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  phase text NOT NULL CHECK (phase IN ('PREVIEW', 'COMMIT', 'EXPORT')),
  storage_key text,
  file_hash text,
  template_version integer NOT NULL DEFAULT 1,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}',
  result jsonb NOT NULL DEFAULT '{}',
  error_message text,
  lease_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0,
  committed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfer_jobs_claim_idx ON transfer_jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_jobs_import_file_idx ON transfer_jobs(actor_id, kind, file_hash, template_version) WHERE job_type = 'IMPORT';
CREATE UNIQUE INDEX IF NOT EXISTS transfer_jobs_idempotency_idx ON transfer_jobs(actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`;
