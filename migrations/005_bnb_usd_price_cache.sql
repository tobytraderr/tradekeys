create table if not exists bnb_usd_price_cache (
  cache_key text primary key,
  price_usd numeric,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  retry_after timestamptz,
  failure_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_bnb_usd_price_cache_retry_after
  on bnb_usd_price_cache (retry_after asc);

create index if not exists idx_bnb_usd_price_cache_last_success_at
  on bnb_usd_price_cache (last_success_at desc);
