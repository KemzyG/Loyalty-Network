# Loyalty Network

Phase 1 **local** protocol node + HTTP gateway for **football fandom** and **fan communities** (TypeScript).

> **Status:** Prototype / pre-testnet — **not** multi-node or production.  
> **Distribution:** Private / internal only (no public GitHub release).  
> **Protocol version:** `0.4` (package `0.4.0`)  
> **Domain focus:** football clubs, matchday loyalty, official fan communities, gated polls  
> **Reference app:** MadFan

Records **verifiable fan participation** (match attendance, membership, shop, gated live/community/polls). MadFan turns those events into loyalty UX. The protocol does **not** store points. Likes/follows/comments stay in the app.

---

## Git / docs policy

| Tracked in git | Local only (gitignored) |
| --- | --- |
| `src/`, `tests/`, `package.json`, lockfile, configs, `LICENSE`, `.env.example`, **this README** | All other `*.md`, `docs/`, `data/`, `node_modules/`, `dist/` |

---

## Requirements

- Node.js **≥ 20**
- npm 10+

## Quick start

```bash
npm install
npm test
npm run demo
npm run gateway
```

| | |
| --- | --- |
| Gateway | `http://127.0.0.1:8787` |
| Health | `GET /health` |
| Snapshot | `./data/node-snapshot.json` (gitignored) |

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOYALTY_HOST` | `127.0.0.1` | Bind address |
| `LOYALTY_PORT` | `8787` | Port |
| `LOYALTY_DATA_PATH` | `./data/node-snapshot.json` | Ledger snapshot path |
| `LOYALTY_ADMIN_TOKEN` | unset | If set, send as `X-Admin-Token` on admin routes |
| `LOYALTY_DISABLE_DEV` | unset | `1` disables `/dev/*` |
| `NODE_ENV` | unset | `production` also disables `/dev/*` |

See `.env.example`. Copy to `.env` for local defaults — **`npm run gateway` loads `.env` automatically** (does not override vars already set in the shell).

---

## Domain: football fandom + community

| Who issues | Typical events |
| --- | --- |
| **Football club** | `ATTENDED_MATCH`, `MEMBERSHIP_STARTED`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` |
| **Club shop** | `PURCHASE_COMPLETED` |
| **Fan platform (MadFan)** | `JOINED_LIVE`, `CREATED_CONTENT`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` (after gates) |

Code helper: `ISSUER_ROLE_TYPES` / `DOMAIN_FOCUS` in `src/types.ts`.

**Reward priority:** match attendance + membership + spend → community join + achievements → gated live/content/polls. Not likes/follows.

---

## Core event types (`0.4`)

**On protocol:**  
`ATTENDED_MATCH`, `MEMBERSHIP_STARTED`, `PURCHASE_COMPLETED`, `JOINED_LIVE`, `CREATED_CONTENT`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED`

**App-only:** likes, follows, comments, shares

`POLL_VOTED` gate: one vote per supporter per `poll_id` — enforce in MadFan **before** the issuer signs.

---

## HTTP API (short)

| Class | Routes | Auth |
| --- | --- | --- |
| Protocol | `POST /events/prepare`, `POST /events`, `GET` identity/issuer/event/state | Issuer signature on submit |
| Admin | Identities & issuers registry, replay-check | `X-Admin-Token` if configured |
| Dev | `POST /dev/keypair`, `POST /dev/sign-event` | Off in production / `LOYALTY_DISABLE_DEV=1` |

### Minimal match-attendance flow (local)

1. `POST /dev/keypair` ×2 (supporter + club)  
2. `POST /identities` with supporter public key  
3. `POST /issuers` for the football club (`ATTENDED_MATCH`, …)  
4. `POST /events/prepare` → club signs → `POST /events`  
5. `GET /identities/:id/state` → `match_attendance_count`

---

## Scripts

| Command | Description |
| --- | --- |
| `npm test` | Conformance + error paths + gateway tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` / `demo:all` | All gated event types |
| `npm run demo:attended-match` | Club `ATTENDED_MATCH` |
| `npm run demo:membership` | Club `MEMBERSHIP_STARTED` |
| `npm run demo:purchase` | Shop `PURCHASE_COMPLETED` |
| `npm run demo:joined-live` | MadFan `JOINED_LIVE` |
| `npm run demo:created-content` | MadFan `CREATED_CONTENT` |
| `npm run demo:joined-community` | Club `JOINED_COMMUNITY` |
| `npm run demo:achievement` | Club `ACHIEVEMENT_GRANTED` |
| `npm run demo:poll-voted` | Club `POLL_VOTED` |
| `npm run gateway` | Start HTTP gateway |
| `npm run build` | Emit `dist/` |

---

## Architecture

```text
MadFan / curl → Gateway → LoyaltyNode → JSON snapshot
                 ↑
         Club / shop / platform issuers (scoped)
```

---

## Security (testers)

- Prefer `127.0.0.1`  
- Set `LOYALTY_ADMIN_TOKEN` on shared hosts  
- Disable `/dev/*` outside local demos  
- Never commit club issuer private keys  

---

## License

MIT — see `LICENSE`.
