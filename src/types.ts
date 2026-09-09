/**
 * Loyalty Protocol v0.4 — shared types
 *
 * Domain focus (Phase 1): **football fandom** and **fan communities**
 * (match attendance, club membership, shop, live matchday, community hubs, gated polls).
 * Reference app: MadFan.
 */

export const PROTOCOL_VERSION = "0.4" as const;

/** Product domain this Phase 1 node is optimized to model. */
export const DOMAIN_FOCUS = {
  primary: "football_fandom",
  secondary: "fan_community",
  referenceApp: "MadFan",
} as const;

/**
 * Core event types — higher-assurance football & community participation.
 * Vanity social (like/follow/comment/share) stays in the MadFan app layer.
 *
 * `POLL_VOTED` is gated: issuer must enforce one vote per identity per poll
 * before signing (poll_id in off-ledger payload).
 */
export const CORE_EVENT_TYPES = [
  // Matchday & club loyalty
  "ATTENDED_MATCH",
  "MEMBERSHIP_STARTED",
  "PURCHASE_COMPLETED",
  // Fan community & gated engagement
  "JOINED_LIVE",
  "CREATED_CONTENT",
  "JOINED_COMMUNITY",
  "ACHIEVEMENT_GRANTED",
  "POLL_VOTED",
] as const;

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

export type EntityStatus = "active" | "suspended" | "revoked";

export type ProtocolErrorCode =
  | "INVALID_SIGNATURE"
  | "UNKNOWN_IDENTITY"
  | "REVOKED_IDENTITY"
  | "UNKNOWN_ISSUER"
  | "UNAUTHORIZED_ISSUER"
  | "INVALID_EVENT_TYPE"
  | "INVALID_PROOF"
  | "DUPLICATE_EVENT"
  | "REPLAY_DETECTED"
  | "INVALID_SEQUENCE"
  | "INVALID_TIMESTAMP"
  | "INVALID_PROTOCOL_VERSION"
  | "INVALID_STATE_TRANSITION"
  | "MALFORMED_EVENT"
  | "ALREADY_EXISTS";

export interface Identity {
  identity_id: string;
  public_key: string;
  key_algorithm: "Ed25519";
  created_at: number;
  status: EntityStatus;
  protocol_version: typeof PROTOCOL_VERSION;
}

export interface Issuer {
  issuer_id: string;
  organization: string;
  public_key: string;
  allowed_event_types: CoreEventType[];
  status: EntityStatus;
  protocol_version: typeof PROTOCOL_VERSION;
}

export interface EventProof {
  type: "issuer_attestation";
  reference: string | null;
}

export interface ProtocolEvent {
  event_id: string;
  identity_id: string;
  event_type: CoreEventType;
  issuer_id: string;
  timestamp: number;
  sequence: number;
  previous_event: string | null;
  payload_hash: string;
  proof: EventProof;
  signature: string;
  protocol_version: typeof PROTOCOL_VERSION;
}

/** Event fields covered by the signature (no `signature`). */
export type UnsignedEvent = Omit<ProtocolEvent, "signature">;

/**
 * Derived fan/community counters (not points).
 * MadFan maps these into football loyalty tiers and community reputation.
 */
export interface IdentityState {
  identity_id: string;
  /** Stadium / verified match check-ins */
  match_attendance_count: number;
  /** Club / season membership active */
  membership_active: boolean;
  membership_started_at: number | null;
  /** Tickets, merch, or shop purchases */
  purchase_count: number;
  /** Matchday live / watch-along with dwell gate */
  live_join_count: number;
  /** Moderated fan posts / media */
  content_created_count: number;
  /** Official fan community / group joins */
  community_join_count: number;
  /** Club or platform badges (e.g. 10 home games) */
  achievement_count: number;
  /** Gated community / MOTM / club polls (one vote per poll enforced pre-sign) */
  poll_vote_count: number;
  last_sequence: number;
  last_event_id: string | null;
}

export interface CanonicalState {
  protocol_version: typeof PROTOCOL_VERSION;
  identities: Identity[];
  issuers: Issuer[];
  identity_states: IdentityState[];
  ledger_height: number;
  last_ledger_event_id: string | null;
}

export interface SubmitSuccess {
  status: "ACCEPTED";
  state_root: string;
  ledger_height: number;
}

export interface VerifyResult {
  valid: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyBase64: string;
  privateKeyBase64: string;
}

/**
 * Suggested issuer scopes for football fandom + communities.
 * Polls: club or MadFan after one-vote-per-identity gate.
 */
export const ISSUER_ROLE_TYPES = {
  footballClub: [
    "ATTENDED_MATCH",
    "MEMBERSHIP_STARTED",
    "JOINED_COMMUNITY",
    "ACHIEVEMENT_GRANTED",
    "POLL_VOTED",
  ] as const,
  clubShop: ["PURCHASE_COMPLETED"] as const,
  fanPlatform: [
    "JOINED_LIVE",
    "CREATED_CONTENT",
    "JOINED_COMMUNITY",
    "ACHIEVEMENT_GRANTED",
    "POLL_VOTED",
  ] as const,
} as const;

/** Explicitly not protocol core — MadFan social feed only. */
export const APP_ONLY_ENGAGEMENT = [
  "LIKED",
  "FOLLOWED",
  "COMMENTED",
  "SHARED_CONTENT",
] as const;
