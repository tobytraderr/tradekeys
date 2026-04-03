create table if not exists sync_runs (
  id bigserial primary key,
  source text not null,
  mode text not null,
  status text not null,
  details jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists twins (
  twin_id text primary key,
  owner text not null,
  metadata_url text,
  supply numeric not null default 0,
  price_eth numeric not null default 0,
  volume_eth numeric not null default 0,
  total_trades integer not null default 0,
  market_cap_eth numeric not null default 0,
  holders integer not null default 0,
  change_24h_pct numeric not null default 0,
  source_updated_at timestamptz,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists twin_metadata (
  twin_id text primary key references twins(twin_id) on delete cascade,
  metadata_url text not null,
  name text,
  description text,
  image_url text,
  links jsonb,
  starter_questions jsonb,
  payload_hash text not null,
  raw_payload jsonb not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists twin_candles (
  twin_id text not null references twins(twin_id) on delete cascade,
  bucket_start timestamptz not null,
  open numeric not null default 0,
  high numeric not null default 0,
  low numeric not null default 0,
  close numeric not null default 0,
  volume_eth numeric not null default 0,
  volume_shares numeric not null default 0,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (twin_id, bucket_start)
);

create index if not exists idx_twins_volume_eth on twins(volume_eth desc);
create index if not exists idx_twins_created_at on twins(created_at desc);
create index if not exists idx_twins_updated_at on twins(updated_at desc);
create index if not exists idx_twin_candles_twin_bucket on twin_candles(twin_id, bucket_start desc);

create table if not exists homepage_snapshot_cache (
  cache_key text primary key,
  snapshot_json jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  retry_after timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists twin_detail_snapshot_cache (
  twin_id text primary key,
  payload_json jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  retry_after timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_watchlists (
  account text not null,
  twin_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account, twin_id)
);

create index if not exists idx_user_watchlists_account_created_at
  on user_watchlists(account, created_at desc);

create table if not exists user_trade_preferences (
  account text primary key,
  quick_buy_amount integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_alerts (
  id bigserial primary key,
  account text not null,
  twin_id text not null,
  label text not null,
  condition_type text not null,
  threshold numeric not null,
  window_minutes integer,
  status text not null default 'active',
  note text,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_alerts_account_updated_at
  on user_alerts(account, updated_at desc);

create index if not exists idx_user_alerts_account_status
  on user_alerts(account, status);

create index if not exists idx_user_alerts_twin_status
  on user_alerts(twin_id, status);

create table if not exists copilot_prompt_reviews (
  id bigserial primary key,
  prompt text not null,
  account text,
  reason text not null,
  status text not null default 'open',
  response_mode text,
  intent text,
  confidence numeric,
  history jsonb,
  memory jsonb,
  requested_twins jsonb,
  resolved_entities jsonb,
  warnings jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_copilot_prompt_reviews_status_created_at
  on copilot_prompt_reviews(status, created_at desc);

create index if not exists idx_copilot_prompt_reviews_reason_created_at
  on copilot_prompt_reviews(reason, created_at desc);
