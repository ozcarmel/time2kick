# Agent Plan

This application is a virtual-money World Cup prediction game. It must never expose deposits, withdrawals, cash value, prizes, or real-money gambling workflows unless the product is re-scoped with legal counsel.

## Product Rules

- Users start with 1000 game dollars.
- Game dollars have no cash value and cannot be withdrawn.
- Odds are used as game mechanics and must be snapshotted when a virtual bet is placed.
- Every wallet mutation must be ledgered: opening balance, stake lock, win credit, void refund, and admin correction.
- Bets close at scheduled kickoff unless a future live-betting game mode is explicitly designed.
- Knockout market settlement must define whether the result is 90 minutes, extra time, or qualification result before launch.

## Agent Roles

### Tournament Data Agent

- Sync tournament structure: teams, groups, fixtures, stadiums, host city, host country, status, score, and standings.
- Use API-Football as the primary live provider for `league=1` and `season=2026`.
- Use OpenFootball `2026/worldcup.json` as the no-key public schedule source when API-Football credentials are missing.
- Never generate fake tournament teams, groups, fixtures, or odds for production UI.
- Persist normalized snapshots locally to protect the user experience from provider outages.
- Mark data freshness and source in the UI.

### Odds Agent

- Pull match-winner odds from API-Football `/odds?fixture=FIXTURE_ID` when available.
- Disable betting for fixtures without licensed odds.
- Avoid scraping betting websites.
- Normalize bookmaker odds into internal markets.
- Store odds snapshots with provider, market, timestamp, and raw payload reference.

### Wallet Agent

- Maintain a ledger rather than only a current balance.
- Reject stakes greater than available balance.
- Keep operations idempotent so refreshes and retries cannot double-charge users.

### Settlement Agent

- Settle open bets only after official final status is confirmed.
- Support void rules for postponed, abandoned, or provider-corrected matches.
- Run as a background job and record settlement audit metadata.

### UI Expert Agent

- Score every release candidate screen from 1 to 10 in four dimensions:
  - Fan appeal
  - Betting clarity
  - Mobile usability
  - Trust and safety
- Compare patterns against leading sports products:
  - ESPN for scoreboard scanning
  - FIFA for tournament emotion
  - SofaScore and Flashscore for fixture density
  - FotMob for match detail hierarchy
  - DraftKings and FanDuel for bet-slip clarity, without real-money pressure
- Require action items for any score below 8.

### Admin Agent

- Monitor provider health, odds refreshes, settlement jobs, and anomalous betting patterns.
- Allow manual fixture correction and bet voiding with audit logs.
- Manage private leagues, featured matches, and moderation.

## API Boundary

The frontend calls the backend proxy, not third-party providers directly:

- `GET /api/worldcup/snapshot`
- `GET /api/worldcup/fixtures`
- `GET /api/worldcup/groups`
- `GET /api/worldcup/standings`
- `GET /api/worldcup/odds/:fixtureId`
- `POST /api/bets`
- `GET /api/bets/me`
- `GET /api/leaderboards/global`
- `GET /api/leaderboards/:leagueId`

Server-side provider adapters own API keys, rate limits, retries, and raw payload archival. `API_FOOTBALL_KEY` or `APISPORTS_KEY` is optional for the schedule, but required for live API-Football sync and licensed odds.

## Recommended Backend Model

- `users`
- `wallet_accounts`
- `wallet_ledger_entries`
- `teams`
- `groups`
- `fixtures`
- `venues`
- `odds_snapshots`
- `bets`
- `bet_settlements`
- `leagues`
- `league_members`
- `provider_sync_runs`

## Missing Decisions

- Whether BALLDONTLIE should be added as a second licensed odds/live-data provider after API-Football failures.
- Whether private leagues are in version 1.
- Whether users can bet only pre-match or also live.
- Exact score and over/under markets for version 1.
- Whether leaderboards rank by balance, ROI, accuracy, or a combined score.
- Whether team crests, FIFA marks, and player imagery are licensed.
