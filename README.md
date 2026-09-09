# Loyalty Network

## What the project is

Loyalty Network is a Phase 1 **protocol node** and **HTTP gateway** (TypeScript) that records **verifiable fan participation** for football clubs and fan communities.

Apps such as **MadFan** submit signed events (match attendance, membership, purchases, gated community actions). The node validates them, appends them to a local ledger, and exposes per-identity counters. The protocol stores **events and state**, not loyalty points — the app decides how to reward fans.

| | |
| --- | --- |
| **Status** | Local prototype (single node) |
| **Protocol version** | `0.4` (package `0.4.0`) |
| **Reference app** | MadFan |

Likes, follows, comments, and shares stay in the app and are rejected on-protocol.

---

## Features

- Cryptographic **identities** (supporter) and scoped **issuers** (club, shop, MadFan)
- Eight gated **core event types** with Ed25519 issuer signatures
- Deterministic **state root** and per-identity counters
- **HTTP gateway** for prepare / sign / submit / query
- JSON **snapshot persistence** across gateway restarts
- In-process **demos** (all types, or one type at a time)
- **Conformance**, **error-path**, and **gateway** test suites

**On-protocol events:**  
`ATTENDED_MATCH` · `MEMBERSHIP_STARTED` · `PURCHASE_COMPLETED` · `JOINED_LIVE` · `CREATED_CONTENT` · `JOINED_COMMUNITY` · `ACHIEVEMENT_GRANTED` · `POLL_VOTED`

**Issuer roles** (`ISSUER_ROLE_TYPES` in `src/types.ts`):

| Role | Events |
| --- | --- |
| Football club | `ATTENDED_MATCH`, `MEMBERSHIP_STARTED`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` |
| Club shop | `PURCHASE_COMPLETED` |
| Fan platform (MadFan) | `JOINED_LIVE`, `CREATED_CONTENT`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` |

`POLL_VOTED`: enforce one vote per `(identity, poll_id)` in the app **before** the issuer signs.

---

## Requirements

- **Node.js** ≥ 20
- **npm** 10+

```bash
node -v
npm -v
```

---

## Installation

```bash
npm install
```

Optional local env file:

```bash
# PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

---

## Configuration

`npm run gateway` loads `.env` automatically if present. Shell environment variables are not overridden.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOYALTY_HOST` | `127.0.0.1` | Bind address |
| `LOYALTY_PORT` | `8787` | HTTP port |
| `LOYALTY_DATA_PATH` | `./data/node-snapshot.json` | Ledger snapshot path |
| `LOYALTY_ADMIN_TOKEN` | unset | If set, send as `X-Admin-Token` on admin/dev routes |
| `LOYALTY_DISABLE_DEV` | unset | `1` disables `/dev/*` |
| `NODE_ENV` | unset | `production` also disables `/dev/*` |

See `.env.example` for a template.

---

## How to

### Run demos (in-process, no server)

```bash
npm run demo                    # all eight event types
npm run demo:attended-match
npm run demo:membership
npm run demo:purchase
npm run demo:joined-community
npm run demo:achievement
npm run demo:poll-voted
npm run demo:joined-live
npm run demo:created-content
```

### Run the gateway

```bash
npm run gateway
```

- Base URL: `http://127.0.0.1:8787`
- Health: `GET /health`

### Submit a match-attendance event (local)

1. `POST /dev/keypair` ×2 (supporter + club)
2. `POST /identities` with supporter `public_key`
3. `POST /issuers` for the club (include `ATTENDED_MATCH`)
4. `POST /events/prepare` → sign with `POST /dev/sign-event` → `POST /events`
5. `GET /identities/:id/state` → `match_attendance_count`

```powershell
$keys = Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/dev/keypair -ContentType "application/json"
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/identities `
  -ContentType "application/json" `
  -Body (@{ public_key = $keys.public_key } | ConvertTo-Json)
```

### Test

```bash
npm test              # full suite
npm run test:watch    # watch mode
npm run typecheck     # TypeScript check
npm run build         # emit dist/
```

| Suite | File |
| --- | --- |
| Conformance | `tests/conformance.test.ts` |
| Error paths | `tests/error-paths.test.ts` |
| Gateway | `tests/gateway.test.ts` |

### API reference

| Class | Routes |
| --- | --- |
| Protocol | `POST /events/prepare`, `POST /events`, `GET` identity / issuer / event / state |
| Admin | Identities & issuers registry, `POST /state/replay-check` |
| Dev | `POST /dev/keypair`, `POST /dev/sign-event` |

| | |
| --- | --- |
| Library entry | `src/index.ts` (`LoyaltyNode`, crypto, types) |
| Gateway entry | `src/gateway/main.ts` |
| Wire fields | `snake_case` |
| Crypto | Ed25519 (`@noble/ed25519`) |

---

## Project architecture

```text
You / MadFan / demos
        │
        ▼
   HTTP Gateway          src/gateway/
   (routes, env, persist)
        │
        ▼
   LoyaltyNode           src/node.ts
   ├── Identity & issuer registry
   ├── Event validation (sig, sequence, replay, permissions)
   ├── State transitions (counters)
   └── Canonical state → state_root
        │
        ▼
   JSON snapshot         ./data/node-snapshot.json
```

| Path | Responsibility |
| --- | --- |
| `src/node.ts` | Core ledger, registry, validation, state |
| `src/crypto.ts` | Keypairs, hashes, IDs, sign / verify |
| `src/canonical.ts` | Canonical JSON for signing and state root |
| `src/types.ts` | Protocol version, event types, issuer roles |
| `src/errors.ts` | `ProtocolError` codes |
| `src/gateway/http.ts` | HTTP routes |
| `src/gateway/main.ts` | Process entry |
| `src/gateway/persist.ts` | Snapshot load / save |
| `src/gateway/loadEnv.ts` | `.env` loader |
| `src/demo/` | In-process demos (`harness.ts` + per-event scripts) |
| `tests/` | Conformance, error paths, gateway |

Phase 1 finality is **single-node**: `ACCEPTED` means accepted on this local node.

---

## License

MIT — see `LICENSE`.
