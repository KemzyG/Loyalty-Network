# Loyalty Network

Phase 1 **protocol node** and **HTTP gateway** for recording verifiable fan participation in **football fandom** and **fan communities**.

MadFan (and other apps) issue signed events; this node validates them, appends them to a local ledger, and exposes per-identity protocol state. The protocol stores **events and counters**, not loyalty points. Apps decide how to reward fans.

| | |
| --- | --- |
| **Status** | Prototype / pre-testnet — single-node, local finality |
| **Distribution** | Private / internal only |
| **Protocol version** | `0.4` (package `0.4.0`) |
| **Stack** | TypeScript, Node.js ≥ 20, Ed25519 (`@noble/ed25519`) |
| **Reference app** | MadFan |

> **Not in scope for Phase 1:** multi-node consensus, P2P, on-chain anchoring, tokens, or production hardening.

---

## What this project does

1. Registers **identities** (supporters) and **issuers** (club, shop, MadFan) with scoped event permissions.
2. Accepts **signed protocol events** (match attendance, membership, purchases, gated community actions).
3. Maintains a deterministic **state root** and per-identity counters.
4. Persists a JSON **snapshot** so the gateway can restart without losing ledger state.
5. Exposes an HTTP API for MadFan / curl / local integration spikes.

**Design rules**

- Events over points — loyalty UX lives in the app.
- Farmable social (likes, follows, comments, shares) stays **app-only** and is rejected on-protocol.
- `POLL_VOTED` uniqueness (one vote per identity per `poll_id`) is enforced by the issuer **before** signing; the protocol only increments `poll_vote_count`.

---

## Repository layout

```text
Loyalty Network/
├── src/
│   ├── index.ts              # Public exports
│   ├── types.ts              # Protocol version, event types, issuer roles
│   ├── errors.ts             # ProtocolError + error codes
│   ├── canonical.ts          # Canonical JSON for signing / state root
│   ├── crypto.ts             # Ed25519, SHA-256, IDs, sign/verify
│   ├── node.ts               # LoyaltyNode — registry, validate, ledger, state
│   ├── gateway/
│   │   ├── main.ts           # Process entry: env, load snapshot, listen
│   │   ├── http.ts           # HTTP routes
│   │   ├── persist.ts        # Snapshot load / save
│   │   └── loadEnv.ts        # Local .env loader
│   └── demo/                 # In-process demos (no HTTP required)
│       ├── harness.ts        # Shared demo setup
│       ├── all.ts            # All eight gated types
│       └── *.ts              # One demo per event type
├── tests/
│   ├── conformance.test.ts   # Spec happy-path / determinism
│   ├── error-paths.test.ts   # Protocol error codes & edges
│   └── gateway.test.ts       # HTTP + admin + persistence
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── LICENSE
└── README.md                 # This file (only markdown tracked in git)
```

| Module | Responsibility |
| --- | --- |
| `LoyaltyNode` (`src/node.ts`) | Identities, issuers, event validation, transitions, snapshot, `state_root` |
| Crypto (`src/crypto.ts`) | Keypairs, `payload_hash`, `event_id` / `identity_id` / `issuer_id`, signatures |
| Gateway (`src/gateway/`) | HTTP surface over the node + JSON persistence |
| Demos (`src/demo/`) | Exercise each event type in-process |
| Tests (`tests/`) | Conformance, error paths, gateway |

Local-only (gitignored): `docs/`, protocol specs, `GATEWAY.md`, `SECURITY.md`, `data/`, `.env`, `node_modules/`, `dist/`.

---

## Prerequisites

- **Node.js** ≥ 20
- **npm** 10+

Verify:

```bash
node -v
npm -v
```

---

## Setup

```bash
# From the project root
npm install
```

Optional local config:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Edit `.env` if you need a non-default port, admin token, or data path.  
`npm run gateway` loads `.env` automatically and **does not** override variables already set in the shell.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOYALTY_HOST` | `127.0.0.1` | Bind address |
| `LOYALTY_PORT` | `8787` | HTTP port |
| `LOYALTY_DATA_PATH` | `./data/node-snapshot.json` | Ledger snapshot file |
| `LOYALTY_ADMIN_TOKEN` | unset | If set, required as `X-Admin-Token` on admin/dev routes |
| `LOYALTY_DISABLE_DEV` | unset | `1` disables `/dev/*` |
| `NODE_ENV` | unset | `production` also disables `/dev/*` |

---

## Verify the install

```bash
npm run typecheck   # TypeScript strict check
npm test            # 36 tests: conformance + error paths + gateway
npm run demo        # In-process demo of all gated event types
```

Expected: typecheck clean, all tests pass, demo prints eight accepts and identity counters (`ledger_height: 8`).

---

## Running demos

Demos use an in-memory `LoyaltyNode` (no gateway). Shared setup lives in `src/demo/harness.ts`.

| Command | What it exercises |
| --- | --- |
| `npm run demo` / `demo:all` | All eight gated event types |
| `npm run demo:attended-match` | Club `ATTENDED_MATCH` |
| `npm run demo:membership` | Club `MEMBERSHIP_STARTED` |
| `npm run demo:purchase` | Shop `PURCHASE_COMPLETED` |
| `npm run demo:joined-community` | Club `JOINED_COMMUNITY` |
| `npm run demo:achievement` | Club `ACHIEVEMENT_GRANTED` |
| `npm run demo:poll-voted` | Club `POLL_VOTED` |
| `npm run demo:joined-live` | MadFan `JOINED_LIVE` |
| `npm run demo:created-content` | MadFan `CREATED_CONTENT` |

Each single-type demo registers only the issuer role it needs and prints the relevant counter.

---

## Testing

```bash
npm test              # One-shot (CI-friendly)
npm run test:watch    # Vitest watch mode
npm run typecheck     # tsc --noEmit
npm run build         # Emit dist/ (JS + .d.ts)
```

| Suite | File | Covers |
| --- | --- | --- |
| Conformance | `tests/conformance.test.ts` | Determinism, duplicates, signatures, sequence, membership transition, counters, farmable reject, revoke, snapshot replay |
| Error paths | `tests/error-paths.test.ts` | `UNKNOWN_*`, `MALFORMED_EVENT`, `INVALID_*`, `REPLAY_DETECTED`, suspend, rotate, timestamp window |
| Gateway | `tests/gateway.test.ts` | Health, attendance HTTP slice, admin token, persist/reload, protocol error JSON, pre-event state 404 |

---

## Running the gateway

```bash
npm run gateway
```

| | |
| --- | --- |
| Base URL | `http://127.0.0.1:8787` |
| Health | `GET /health` |
| Snapshot | `./data/node-snapshot.json` (created on first write; gitignored) |

### API overview

| Class | Routes | Auth |
| --- | --- | --- |
| Protocol | `POST /events/prepare`, `POST /events`, `GET` identity / issuer / event / state | Issuer Ed25519 signature on submit |
| Admin | Create/rotate/suspend/revoke identities & issuers, `POST /state/replay-check` | `X-Admin-Token` if `LOYALTY_ADMIN_TOKEN` is set |
| Dev | `POST /dev/keypair`, `POST /dev/sign-event` | Same admin header when configured; **off** in production / `LOYALTY_DISABLE_DEV=1` |

### Minimal local flow (`ATTENDED_MATCH`)

1. `POST /dev/keypair` twice (supporter + club).
2. `POST /identities` with the supporter `public_key`.
3. `POST /issuers` for the club with allowed types including `ATTENDED_MATCH`.
4. `POST /events/prepare` with `identity_id`, `issuer_id`, `event_type`, `payload`.
5. Sign the unsigned event (`POST /dev/sign-event` locally, or your KMS in production).
6. `POST /events` with the signed event → `ACCEPTED`.
7. `GET /identities/:id/state` → `match_attendance_count`.

**PowerShell example (create identity):**

```powershell
$keys = Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/dev/keypair -ContentType "application/json"
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/identities `
  -ContentType "application/json" `
  -Body (@{ public_key = $keys.public_key } | ConvertTo-Json)
```

If `LOYALTY_ADMIN_TOKEN` is set, add header `X-Admin-Token: <token>` on admin and dev calls.

---

## Domain model (v0.4)

### Who issues what

| Issuer role | Typical events |
| --- | --- |
| **Football club** | `ATTENDED_MATCH`, `MEMBERSHIP_STARTED`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` |
| **Club shop** | `PURCHASE_COMPLETED` |
| **Fan platform (MadFan)** | `JOINED_LIVE`, `CREATED_CONTENT`, `JOINED_COMMUNITY`, `ACHIEVEMENT_GRANTED`, `POLL_VOTED` |

Helpers: `ISSUER_ROLE_TYPES` and `DOMAIN_FOCUS` in `src/types.ts`.

### On-protocol event types

`ATTENDED_MATCH` · `MEMBERSHIP_STARTED` · `PURCHASE_COMPLETED` · `JOINED_LIVE` · `CREATED_CONTENT` · `JOINED_COMMUNITY` · `ACHIEVEMENT_GRANTED` · `POLL_VOTED`

### App-only (rejected on wire)

`LIKED` · `FOLLOWED` · `COMMENTED` · `SHARED_CONTENT`

### Reward priority (product guidance)

1. Attendance, membership, purchases  
2. Community join, achievements, gated polls  
3. Gated live / moderated content  
4. Social vanity — app DB only  

---

## Architecture

```text
MadFan / curl / demos
        │
        ▼
   HTTP Gateway  ── persist ──► ./data/node-snapshot.json
        │
        ▼
   LoyaltyNode
   ├── Identity & issuer registry
   ├── Event validate (sig, sequence, replay, timestamp, permissions)
   ├── State transitions (counters)
   └── Canonical state → state_root (SHA-256)
        ▲
        │
 Club / shop / platform issuers (scoped allowed_event_types)
```

Phase 1 finality: **single node**. `ACCEPTED` ≡ locally finalized. No BFT yet.

Wire/protocol fields use **snake_case**; TypeScript APIs use **camelCase** where applicable.

---

## Security notes (local prototype)

- Bind to `127.0.0.1` by default; do not expose to the public internet.
- Set `LOYALTY_ADMIN_TOKEN` on any shared host.
- Disable `/dev/*` outside laptop demos (`LOYALTY_DISABLE_DEV=1` or `NODE_ENV=production`).
- Never commit `.env`, issuer private keys, or `data/` snapshots with real keys.
- `/dev/sign-event` accepts a private key in the request body — local tooling only.

---

## Scripts reference

| Command | Description |
| --- | --- |
| `npm install` | Install dependencies |
| `npm test` | Run full Vitest suite |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |
| `npm run gateway` | Start HTTP gateway |
| `npm run demo` / `demo:*` | In-process event demos |

---

## Git / docs policy

| Tracked | Local only (gitignored) |
| --- | --- |
| `src/`, `tests/`, `package.json`, lockfile, configs, `LICENSE`, `.env.example`, **this README** | Other `*.md`, `docs/`, `data/`, `node_modules/`, `dist/`, `.env` |

Normative protocol specs and extended gateway notes may exist locally; clones rely on this README unless those files are shared separately.

---

## License

MIT — see `LICENSE`.

Internal distribution preference does not change the license text in this repository; align LICENSE with legal intent before any wider release.
