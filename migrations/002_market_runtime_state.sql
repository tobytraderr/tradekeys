create table if not exists market_runtime_snapshots (
  snapshot_key text primary key,
  contract_version integer not null,
  source text not null,
  payload_json jsonb not null,
  generated_at timestamptz not null,
  stale_after timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_runtime_snapshots_generated_at
  on market_runtime_snapshots(generated_at desc);

create table if not exists market_twin_detail_snapshots (
  twin_id text primary key,
  contract_version integer not null,
  source text not null,
  payload_json jsonb not null,
  generated_at timestamptz not null,
  stale_after timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_twin_detail_snapshots_generated_at
  on market_twin_detail_snapshots(generated_at desc);
