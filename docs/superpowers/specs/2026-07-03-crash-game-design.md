# Phase 1 — Crash Game & UI Design

**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 0 wallet & ledger (escrow/settle/refund primitives, `onUserCreated`).

---

## Context & Goals

Phase 1 makes the wallet *do something*: a **Crash** game — a rising multiplier the player must cash out before it "crashes" — plus the first real **UI** (a login and the game screen). It validates the Phase 0 wallet end-to-end (bet → RNG → settle → payout) and establishes the app's visual identity.

**Model decisions (locked in brainstorming):**
- **Solo rounds** — each player gets their own round. No shared game loop, no WebSocket server.
- **Server-authoritative** — the crash point is decided and held server-side; the client only animates. Cash-out is validated against the server's own clock, so the client animation can't cheat.
- **Provably fair** — the crash point is committed via `SHA256(serverSeed)` before the bet and the seed is revealed on settlement for verification.
- **Lightweight dev login** — a username → signed session cookie; real Supabase auth is a later phase. Dev login is disabled in production (fails closed).
- **UI** — based on the Stitch "Cyber-Arcade" design system (`docs/DESIGN-crash-cyber-arcade.md`), adjusted for the closed play-money economy.

**Success criteria:**
- A player can log in, place a Crash bet, watch the multiplier rise, cash out (or bust), and see chips move correctly in the wallet — every outcome settled through the Phase 0 ledger with no drift.
- The crash point is provably fair and verifiable after each round.
- No round can leave escrow dangling (abandoned rounds auto-resolve).

## Non-Goals (Phase 1)

- Real Supabase auth (dev login only).
- Multiplayer / shared rounds, live chat, sound.
- Other games (sports, slots), leaderboard, rewards, deposits/withdrawals (none exist — closed economy).

---

## Section 1 — Game Model & Cheat-Proofing

The client animates a rising multiplier but **never learns the crash point** (otherwise it could auto-cash-out at crash−ε and never lose). Authority rules:

- On **bet**, the server picks the crash point, records `startedAt` (server clock), and returns only the commit hash + start time + growth rate.
- On **cash-out**, the server computes the multiplier from *its own* elapsed time: `m = e^(k·Δt)`. If `m ≥ crashPoint` → too late, **busted**; else **win** at `m`.
- **Visible busts without WebSockets:** while a round is `RUNNING`, the client polls `GET /api/crash/round/:id` (~300 ms). The response gives the current server multiplier and, the instant server time passes the crash point, returns `BUSTED` + the revealed seed. The crash point is precomputed — the poll only reads state; there is no server game loop.
- **Abandoned rounds:** the crash *time* is computable (`t = ln(x)/k`). A `resolveExpiredRounds()` sweep — and lazy resolution inside the status poll — busts any `RUNNING` round past its crash time, releasing escrow. No round stays open forever.
- **One active round per user** (enforced by a partial unique index on `userId` where `status = RUNNING`); a new bet first resolves any expired round.

---

## Section 2 — Provably-Fair Crash Math

All multipliers are stored as **integer hundredths** (2.47× → `247`) to stay integer-only alongside chips.

**Growth:** `multiplier(tSeconds) = e^(GROWTH_RATE · t)`, `GROWTH_RATE = 0.155` (≈2× at ~4.5 s). Displayed value floored to 2 decimals: `floor(e^(k·t) · 100)`.

**Commit / reveal:**
- `serverSeed` = 32 random bytes (hex), fresh per round. `commitHash = SHA256(serverSeed)` (hex), returned at bet time.
- `clientSeed` = a string supplied by the client (or a per-round default).
- On settlement the server returns `serverSeed`; anyone can check `SHA256(serverSeed) == commitHash` and re-derive the crash point.

**Crash-point derivation (bustabit-style, house edge via instant-bust):**
```
h = first 52 bits of HMAC_SHA256(key = serverSeed, msg = clientSeed)   // integer in [0, 2^52)
if (h % HOUSE_EDGE_DIVISOR === 0) return 100                            // 1.00× instant bust
const e = 2 ** 52
return Math.floor((100 * e - h) / (e - h))                             // crash point in hundredths
```
`HOUSE_EDGE_DIVISOR = 101` → ≈1% house edge; median crash ≈ 2×, heavy tail. All 64-bit-safe integer math (use `BigInt` for `2^52` where needed).

**Cash-out payout:** `payout = floor(stake · cashoutHundredths / 100)`, settled via the wallet's `settle(stake, payout, key)`.

**Auto cash-out:** if the player sets a target `T` (hundredths) at bet time, the outcome is deterministic: win at `T` if `T ≤ crashPoint`, else bust. A manual cash-out earlier than `T` still wins at the manual multiplier.

---

## Section 3 — Data Model, Lifecycle & Wallet Integration

**New table `CrashRound`:**
`id`, `userId`, `stake` (BigInt), `clientSeed` (String), `serverSeed` (String — stored always, exposed only after settle), `commitHash` (String), `crashPoint` (Int, hundredths — hidden until settle), `autoCashout` (Int?, hundredths), `status` (`RUNNING | CASHED_OUT | BUSTED`), `startedAt` (DateTime), `cashoutMultiplier` (Int?, hundredths), `payout` (BigInt?), `settledAt` (DateTime?). Partial unique index on `userId WHERE status = 'RUNNING'`.

The wallet ledger stays the source of truth for chips; `CrashRound` is game state only.

**Lifecycle & wallet calls (reusing Phase 0 primitives — no new wallet code):**
1. `bet`: resolve any expired round → validate stake (`MIN_STAKE ≤ stake ≤ available`) → `escrow(userId, stake, "crash:{roundId}:place")` → create `RUNNING` round with seed/commit/crashPoint/startedAt → return `{roundId, commitHash, startedAt, growthRate, autoCashout}`.
2. `cashout`: compute server multiplier; **win** → `settle(userId, stake, floor(stake·m/100), "crash:{roundId}:settle")`, status `CASHED_OUT`; **too late** → `settle(userId, stake, 0, ...)`, status `BUSTED`. Reveal seed + crashPoint.
3. `status poll` / `sweep`: lazily settle expired/auto rounds the same way.

Idempotency keys are round-scoped, so a double-tapped cash-out or a racing sweep settles **exactly once** — the guarantee Phase 0 exists to provide.

---

## Section 4 — Dev Auth / Session

- `POST /api/auth/dev-login {username}` → `onUserCreated(userId)` (idempotent: provisions wallet + signup bonus) → set signed cookie `session = base64url(userId) + "." + HMAC_SHA256(userId, SESSION_SECRET)`. Returns `{userId}`.
- `POST /api/auth/logout` → clears the cookie.
- `requireUserId(req)` (extends Phase 0's): honors the signed dev cookie **only when `NODE_ENV !== "production"`**; keeps the `TEST_AUTH` header path for tests; otherwise 401. Dev-login route itself 403s in production.
- New env var `SESSION_SECRET` (required in dev).

---

## Section 5 — UI (Stitch "Cyber-Arcade")

Add Tailwind to the Next.js app (scaffolded without it) and encode the Cyber-Arcade tokens from `docs/DESIGN-crash-cyber-arcade.md` (palette: bg `#0b0e11`, primary/green `#24e39b`, crash/red `#ff4c5e`, gold `#ffc24b`; JetBrains/Space Mono for numerals). Dark, single-theme (a deliberate committed look for an arcade game).

**Adjustments from the raw Stitch output:** remove **Deposit** and any cash-out/withdraw language (closed economy) — replace with the **Daily bonus** claim; **defer Leaderboard / Rewards / Support**; ship the nav rail with **Play / History / Fairness**.

**Pages (App Router):**
- `/login` — username field → dev-login → redirect to `/play`.
- `/play` — the Crash screen: left nav rail (brand, Play/History/Fairness, Daily-bonus, wallet balance), center stage (canvas curve + big multiplier readout + "provably fair · committed" badge + cash-out hint), bet panel (stake input with ± and quick-add, auto-cash-out toggle, one action button that swaps green **BET** ↔ gold **CASH OUT @m×**), right sidebar (Recent Rounds pills + Provably-Fair card with commit hash + Verify).
- `/history` — the player's recent settled rounds.
- `/fairness` — how provably-fair works + a verify view for a round.

**Client game logic** (a `/play` client component): on BET → POST bet, animate the multiplier locally from `startedAt` using `growthRate` (canvas + `requestAnimationFrame`, `prefers-reduced-motion` respected), poll status every 300 ms; on CASH OUT → POST cashout, render win; on bust (from poll) → render crash + reveal. The displayed multiplier is cosmetic; the server number governs the outcome.

**Components:** `NavRail`, `WalletChip`, `CrashStage` (canvas), `MultiplierReadout`, `BetPanel`, `RecentRounds`, `FairnessCard`.

---

## Section 6 — API Surface

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/dev-login` | Username → signed session (dev only) |
| `POST /api/auth/logout` | Clear session |
| `GET /api/wallet` | (Phase 0) balances |
| `POST /api/wallet/daily-bonus` | (Phase 0) claim daily bonus |
| `POST /api/crash/bet` | Place a bet; returns roundId + commit hash + startedAt (no crash point) |
| `GET /api/crash/round/:id` | Status poll: server multiplier; reveals crash point + seed once settled |
| `POST /api/crash/cashout` | Cash out; settles win/bust, reveals seed |
| `GET /api/crash/history` | Player's recent settled rounds |
| `GET /api/crash/verify/:id` | Fairness data (commit, seed, clientSeed, crash point) for a settled round |

`escrow`/`settle` remain internal — never public.

---

## Section 7 — Testing Strategy

Correctness of chips is still the bar; the game just adds new ways to move them.

1. **Crash math** (`crash-math.test.ts`): `SHA256(seed) == commit`; `crashPointFromHash` deterministic; distribution sanity over many samples (median ≈ 2×, instant-bust rate ≈ `1/HOUSE_EDGE_DIVISOR`, never < 1.00×); `multiplier(t)` monotonic; `crashTime` is the correct inverse.
2. **Round lifecycle** (`crash-round.test.ts`, against real Postgres): bet escrows the stake; cash-out win settles `floor(stake·m/100)`; bust settles a loss; auto-cash-out win/bust; abandoned round swept to a loss; single-active-round enforced; **double cash-out is idempotent** (settles once). Every case asserts correct ledger balances + `assertConservation()` + zero `findBalanceDrift()`.
3. **Server authority** (route test): a cash-out request cannot claim a higher multiplier than the server's elapsed time allows; the crash point is absent from responses until the round is settled, present after.
4. **Dev auth** (`dev-auth.test.ts`): dev-login issues a valid cookie `requireUserId` accepts; a forged/edited cookie is rejected; dev-login and cookie auth both fail closed when `NODE_ENV === "production"`.
5. **API/routes**: bet/cashout/round/history/verify happy paths + rejections (insufficient balance, unknown round, unauthorized).

**Infrastructure:** same as Phase 0 — Vitest against the real local Postgres, `fileParallelism: false`. UI logic kept thin; the game's correctness lives in tested server code, not the React layer.

---

## Roadmap (context only)

- **Phase 0 — Wallet & ledger** ✅
- **Phase 1 — Crash game + UI** ← this spec
- **Phase 2 — Sports betting** (market state machine + manual→API resolver)
- **Phase 3 — Slots**
- **Later — Supabase auth, leaderboard, rewards, social**
