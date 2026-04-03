create table if not exists wallet_auth_challenges (
  nonce text primary key,
  account text not null,
  message text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_auth_challenges_expires_at
  on wallet_auth_challenges (expires_at asc);

create table if not exists wallet_auth_sessions (
  token text primary key,
  account text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_auth_sessions_expires_at
  on wallet_auth_sessions (expires_at asc);
