create table if not exists copilot_daily_usage (
  usage_key text not null,
  usage_day date not null,
  prompt_count integer not null default 0,
  last_prompt_at timestamptz not null default now(),
  primary key (usage_key, usage_day)
);

create index if not exists idx_copilot_daily_usage_day
  on copilot_daily_usage (usage_day desc, last_prompt_at desc);
