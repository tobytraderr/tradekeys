# TradeKeys

TradeKeys is a beta trading terminal for discovering, evaluating, and trading digital twin keys faster.

It is built around a simple product idea:

- discover twins faster than the native experience alone
- understand price, holders, volume, and flow with terminal-style context
- execute from live contract quotes, not display-only indexed prices
- use the same keys on Twin.fun when those twins support gated access or utility

![TradeKeys homepage](public/onboarding/first%20slide.png)

## Why TradeKeys Exists

Twin.fun already has the market. TradeKeys is the faster operating layer around it.

The product is designed for users who want to:

- spot active twins faster
- compare setups without tab-hopping
- move from discovery to execution with less friction
- understand what a twin is doing before they commit capital

In short:

TradeKeys is for faster discovery, clearer context, and cleaner decision-making.

## Beta Positioning

TradeKeys is not trying to replace Twin.fun.

It is the faster discovery and decision layer around Twin.fun markets:

- TradeKeys helps users find and monitor twins quickly
- TradeKeys gives trading context through homepage feeds, watchlists, detail pages, and AI-assisted analysis
- the keys bought here are the same twin keys used on Twin.fun

## Core Product Surfaces

- `/` homepage discovery terminal
- `/twin/[id]` twin detail and trading
- `/watchlist` saved monitoring view
- `/portfolio` wallet positions and exposure
- `/ai-copilot` AI-assisted market breakdowns
- `/create` twin creation helper flow
- `/settings/featured` featured twin control
- `/admin` internal admin console when admin env vars are configured

## First Five Minutes

If you are opening TradeKeys for the first time, the intended flow is:

1. connect your wallet
2. scan the homepage for active, fresh, or trending twins
3. open a twin detail page to inspect price, holders, volume, and recent flow
4. add promising twins to your watchlist
5. use AI Copilot when you want a faster breakdown or comparison
6. execute only after reviewing the live quote

That sequence reflects the core product promise:

discover first, understand second, trade last

## How TradeKeys Reads Market Data

TradeKeys uses a hybrid model.

### Live Contract / RPC

These are the source of truth for execution-critical values:

- buy quote
- sell quote
- wallet balances
- current supply used for settlement
- transaction submission

Relevant files:

- [`lib/server/rpc.ts`](lib/server/rpc.ts)
- [`components/trade-panel.tsx`](components/trade-panel.tsx)
- [`components/quick-buy-control.tsx`](components/quick-buy-control.tsx)

### Indexed Market Data

These are used for market context and discovery:

- homepage feeds
- search and watchlist context
- twin detail history
- activity and momentum views

Relevant files:

- [`lib/server/subgraph.ts`](lib/server/subgraph.ts)
- [`lib/services/market/homepage.ts`](lib/services/market/homepage.ts)
- [`lib/services/market/detail.ts`](lib/services/market/detail.ts)
- [`lib/services/market/search.ts`](lib/services/market/search.ts)
- [`lib/services/market/watchlist.ts`](lib/services/market/watchlist.ts)

### Catalog Ingestion

The canonical catalog sync script primarily uses `TWINFUN_INDEXER_URL`.

Browser-capture fallback is now an explicit local/manual option only and is disabled by default unless `ALLOW_BROWSER_CAPTURE_FALLBACK=true`.

Relevant files:

- [`scripts/sync_twin_catalog.mjs`](scripts/sync_twin_catalog.mjs)
- [`scripts/collect_twins_via_playwright.mjs`](scripts/collect_twins_via_playwright.mjs)
- [`lib/server/catalog-store.ts`](lib/server/catalog-store.ts)

## Execution Model

TradeKeys is intentionally opinionated about trading safety:

- indexed prices are for context
- execution always depends on a fresh live quote
- wallet approval is explicit
- displayed USD values are informational, not settlement values

This distinction matters:

- discovery and monitoring can tolerate indexing delay
- execution cannot

## Beta Caveats

Current product realities to be aware of:

- homepage market context is snapshot-based, not tick-by-tick live
- the homepage freshness window is currently one minute
- if upstream refresh fails, TradeKeys prefers serving a stale snapshot over a hard blank state
- AI Copilot can be limited or degraded depending on environment configuration and daily prompt limits

## Security Posture

TradeKeys is money-adjacent software. Treat every quote, wallet interaction, and execution flow as sensitive.

Current principles:

- never execute from indexed prices
- never trust client input without server validation
- never let a privileged server path sign a user transaction
- never expose sensitive secrets to the browser
- keep admin and internal debug surfaces gated

Relevant files:

- [`proxy.ts`](proxy.ts)
- [`lib/trade-safety.ts`](lib/trade-safety.ts)
- [`docs/security-review.md`](docs/security-review.md)
- [`docs/tradekeys-threat-model.md`](docs/tradekeys-threat-model.md)

## AI Copilot

TradeKeys uses an OpenGradient-backed Python bridge for verifiable AI responses.

Runtime flow:

1. the app collects grounded twin context
2. Node spawns the Python bridge
3. Python calls OpenGradient
4. the response is sanitized and returned to the app

Relevant files:

- [`lib/services/copilot.ts`](lib/services/copilot.ts)
- [`scripts/opengradient_copilot.py`](scripts/opengradient_copilot.py)
- [`app/api/ai/copilot/route.ts`](app/api/ai/copilot/route.ts)
- [`requirements.txt`](requirements.txt)

## Local Setup

Install Node dependencies:

```bash
npm install --cache .npm-cache
```

Install Python dependencies:

```bash
python -m pip install -r requirements.txt
```

Copy envs:

```bash
cp .env.example .env
```

Run migrations:

```bash
npm run db:migrate
```

Start the app:

```bash
npm run dev
```

Useful commands:

```bash
npm run typecheck
npm run lint
npm run build
npm run sync:twins
npm run collect:twins
npm run test:copilot
```

## Required Environment

Core runtime:

- `DATABASE_URL`
- `SUBGRAPH_URL`
- `BSC_RPC_URL`
- `SITE_URL`

Catalog and fallback controls:

- `TWINFUN_INDEXER_URL`
- `ALLOW_BROWSER_CAPTURE_FALLBACK`

Copilot:

- `OPENGRADIENT_PRIVATE_KEY`
- `PYTHON_BIN`
- `COPILOT_DAILY_PROMPT_LIMIT_ENABLED`
- `COPILOT_DAILY_PROMPT_LIMIT`

Admin:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_ACCESS_TOKEN`
- `ADMIN_ALLOWED_IPS`

See [`.env.example`](.env.example) for the current full env surface.

## Repo Structure

```text
tradekeys/
  app/                  Next.js routes and API routes
  components/           UI and interactive client components
  lib/                  shared services, env helpers, and server adapters
  lib/contracts/        runtime ABI and network contract artifacts
  migrations/           SQL migrations
  public/               static assets
  scripts/              sync, migration, and AI bridge scripts
  twin/                 optional Twin.fun subgraph workspace
  docs/                 product, ops, and security documentation
```

## Beta Summary

TradeKeys is in a good beta state when configured correctly:

- strong discovery-first positioning
- live execution safety separation
- watchlist and portfolio utility
- internal admin and observability support
- onboarding and link-sharing flows that reinforce distribution

The next product challenge is no longer just stability. It is proving that TradeKeys helps users discover and act better than the default market experience alone.
