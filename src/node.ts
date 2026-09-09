import {
  decodePublicKey,
  deriveIdentityId,
  deriveIssuerId,
  deriveEventId,
  signEvent,
  stateRootHex,
  verifyEventSignature,
} from "./crypto.js";
import { ProtocolError } from "./errors.js";
import {
  CORE_EVENT_TYPES,
  PROTOCOL_VERSION,
  type CanonicalState,
  type CoreEventType,
  type Identity,
  type IdentityState,
  type Issuer,
  type ProtocolEvent,
  type SubmitSuccess,
  type UnsignedEvent,
  type VerifyResult,
} from "./types.js";

const PAYLOAD_HASH_RE = /^sha256:[0-9a-f]{64}$/;

function emptyIdentityState(identityId: string): IdentityState {
  return {
    identity_id: identityId,
    match_attendance_count: 0,
    membership_active: false,
    membership_started_at: null,
    purchase_count: 0,
    live_join_count: 0,
    content_created_count: 0,
    community_join_count: 0,
    achievement_count: 0,
    poll_vote_count: 0,
    last_sequence: 0,
    last_event_id: null,
  };
}

function isCoreEventType(value: string): value is CoreEventType {
  return (CORE_EVENT_TYPES as readonly string[]).includes(value);
}

function nowSeconds(clock: () => number): number {
  return Math.floor(clock() / 1000);
}

export interface NodeOptions {
  /** Injected clock for deterministic tests (ms). Defaults to Date.now. */
  clock?: () => number;
}

export interface NodeSnapshot {
  identities: Identity[];
  issuers: Issuer[];
  events: ProtocolEvent[];
}

/**
 * Phase 1 single-process Loyalty Protocol node.
 * Domain focus: football fandom + fan communities (MadFan reference app).
 * Local finality: ACCEPTED === FINALIZED.
 */
export class LoyaltyNode {
  private readonly identities = new Map<string, Identity>();
  private readonly issuers = new Map<string, Issuer>();
  private readonly identityStates = new Map<string, IdentityState>();
  private readonly ledger: ProtocolEvent[] = [];
  private readonly eventIndex = new Map<string, ProtocolEvent>();
  private readonly replayKeys = new Set<string>();
  private readonly usedIdentityPubkeys = new Set<string>();
  private readonly usedIssuerPubkeys = new Set<string>();
  private readonly clock: () => number;
  private stateRoot: string;

  constructor(options: NodeOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.stateRoot = this.computeStateRoot();
  }

  // ── Admin ──────────────────────────────────────────────────────────

  createIdentity(publicKeyBase64: string, createdAt?: number): Identity {
    if (this.usedIdentityPubkeys.has(publicKeyBase64)) {
      throw new ProtocolError("ALREADY_EXISTS", "public key already registered");
    }
    const identity_id = deriveIdentityId(decodePublicKey(publicKeyBase64));
    if (this.identities.has(identity_id)) {
      throw new ProtocolError("ALREADY_EXISTS", "identity already exists");
    }
    const identity: Identity = {
      identity_id,
      public_key: publicKeyBase64,
      key_algorithm: "Ed25519",
      created_at: createdAt ?? nowSeconds(this.clock),
      status: "active",
      protocol_version: PROTOCOL_VERSION,
    };
    this.identities.set(identity_id, identity);
    this.usedIdentityPubkeys.add(publicKeyBase64);
    this.recomputeRoot();
    return structuredClone(identity);
  }

  rotateIdentityKey(identityId: string, newPublicKeyBase64: string): Identity {
    const identity = this.requireIdentity(identityId);
    if (this.usedIdentityPubkeys.has(newPublicKeyBase64)) {
      throw new ProtocolError("ALREADY_EXISTS", "public key already registered");
    }
    this.usedIdentityPubkeys.delete(identity.public_key);
    identity.public_key = newPublicKeyBase64;
    this.usedIdentityPubkeys.add(newPublicKeyBase64);
    this.recomputeRoot();
    return structuredClone(identity);
  }

  suspendIdentity(identityId: string): Identity {
    const identity = this.requireIdentity(identityId);
    identity.status = "suspended";
    this.recomputeRoot();
    return structuredClone(identity);
  }

  revokeIdentity(identityId: string): Identity {
    const identity = this.requireIdentity(identityId);
    identity.status = "revoked";
    this.recomputeRoot();
    return structuredClone(identity);
  }

  registerIssuer(
    organization: string,
    publicKeyBase64: string,
    allowedEventTypes: CoreEventType[],
  ): Issuer {
    if (this.usedIssuerPubkeys.has(publicKeyBase64)) {
      throw new ProtocolError(
        "ALREADY_EXISTS",
        "issuer public key already registered",
      );
    }
    for (const t of allowedEventTypes) {
      if (!isCoreEventType(t)) {
        throw new ProtocolError("INVALID_EVENT_TYPE");
      }
    }
    const issuer_id = deriveIssuerId(decodePublicKey(publicKeyBase64));
    if (this.issuers.has(issuer_id)) {
      throw new ProtocolError("ALREADY_EXISTS", "issuer already exists");
    }
    const issuer: Issuer = {
      issuer_id,
      organization,
      public_key: publicKeyBase64,
      allowed_event_types: [...allowedEventTypes],
      status: "active",
      protocol_version: PROTOCOL_VERSION,
    };
    this.issuers.set(issuer_id, issuer);
    this.usedIssuerPubkeys.add(publicKeyBase64);
    this.recomputeRoot();
    return structuredClone(issuer);
  }

  updateIssuerPermissions(
    issuerId: string,
    allowedEventTypes: CoreEventType[],
  ): Issuer {
    const issuer = this.requireIssuer(issuerId);
    for (const t of allowedEventTypes) {
      if (!isCoreEventType(t)) {
        throw new ProtocolError("INVALID_EVENT_TYPE");
      }
    }
    issuer.allowed_event_types = [...allowedEventTypes];
    this.recomputeRoot();
    return structuredClone(issuer);
  }

  suspendIssuer(issuerId: string): Issuer {
    const issuer = this.requireIssuer(issuerId);
    issuer.status = "suspended";
    this.recomputeRoot();
    return structuredClone(issuer);
  }

  revokeIssuer(issuerId: string): Issuer {
    const issuer = this.requireIssuer(issuerId);
    issuer.status = "revoked";
    this.recomputeRoot();
    return structuredClone(issuer);
  }

  // ── Protocol ───────────────────────────────────────────────────────

  submitEvent(event: ProtocolEvent): SubmitSuccess {
    this.validateEvent(event);

    const state = this.getOrCreateIdentityState(event.identity_id);
    this.applyTransition(state, event);

    this.ledger.push(structuredClone(event));
    this.eventIndex.set(event.event_id, structuredClone(event));
    this.replayKeys.add(this.replayKey(event));
    this.recomputeRoot();

    return {
      status: "ACCEPTED",
      state_root: this.stateRoot,
      ledger_height: this.ledger.length,
    };
  }

  getEvent(eventId: string): ProtocolEvent | undefined {
    const event = this.eventIndex.get(eventId);
    return event ? structuredClone(event) : undefined;
  }

  getIdentity(identityId: string): Identity | undefined {
    const identity = this.identities.get(identityId);
    return identity ? structuredClone(identity) : undefined;
  }

  getIssuer(issuerId: string): Issuer | undefined {
    const issuer = this.issuers.get(issuerId);
    return issuer ? structuredClone(issuer) : undefined;
  }

  getIdentityState(identityId: string): IdentityState | undefined {
    const state = this.identityStates.get(identityId);
    return state ? structuredClone(state) : undefined;
  }

  getStateRoot(): string {
    return this.stateRoot;
  }

  getLedgerHeight(): number {
    return this.ledger.length;
  }

  getLedger(): ProtocolEvent[] {
    return this.ledger.map((e) => structuredClone(e));
  }

  getCanonicalState(): CanonicalState {
    return this.buildCanonicalState();
  }

  exportSnapshot(): NodeSnapshot {
    return {
      identities: [...this.identities.values()].map((i) => structuredClone(i)),
      issuers: [...this.issuers.values()].map((i) => structuredClone(i)),
      events: this.getLedger(),
    };
  }

  /**
   * Rebuild a node from registries + ordered ledger (determinism / restart).
   * Applies identity/issuer status from the snapshot after replaying events
   * so late revocations still match canonical state.
   */
  static fromSnapshot(
    snapshot: NodeSnapshot,
    options: NodeOptions = {},
  ): LoyaltyNode {
    const node = new LoyaltyNode(options);

    for (const identity of snapshot.identities) {
      node.createIdentity(identity.public_key, identity.created_at);
    }
    for (const issuer of snapshot.issuers) {
      node.registerIssuer(
        issuer.organization,
        issuer.public_key,
        issuer.allowed_event_types,
      );
    }
    for (const event of snapshot.events) {
      node.submitEvent(structuredClone(event));
    }

    // Apply final registry statuses (may have changed after events).
    for (const identity of snapshot.identities) {
      const current = node.identities.get(identity.identity_id);
      if (!current) continue;
      if (identity.status === "suspended") node.suspendIdentity(identity.identity_id);
      if (identity.status === "revoked") node.revokeIdentity(identity.identity_id);
      if (
        identity.public_key !== current.public_key &&
        identity.status === "active"
      ) {
        node.rotateIdentityKey(identity.identity_id, identity.public_key);
      }
    }
    for (const issuer of snapshot.issuers) {
      const current = node.issuers.get(issuer.issuer_id);
      if (!current) continue;
      if (
        JSON.stringify(issuer.allowed_event_types) !==
        JSON.stringify(current.allowed_event_types)
      ) {
        node.updateIssuerPermissions(issuer.issuer_id, issuer.allowed_event_types);
      }
      if (issuer.status === "suspended") node.suspendIssuer(issuer.issuer_id);
      if (issuer.status === "revoked") node.revokeIssuer(issuer.issuer_id);
    }

    return node;
  }

  replayAndCheckRoot(): { matches: boolean; state_root: string } {
    const twin = LoyaltyNode.fromSnapshot(this.exportSnapshot(), {
      clock: this.clock,
    });
    return {
      matches: twin.stateRoot === this.stateRoot,
      state_root: twin.stateRoot,
    };
  }

  verifyEvent(eventId: string): VerifyResult {
    const checks: VerifyResult["checks"] = [];
    const event = this.eventIndex.get(eventId);
    if (!event) {
      return { valid: false, checks: [{ name: "exists", ok: false }] };
    }
    checks.push({ name: "exists", ok: true });

    const issuer = this.issuers.get(event.issuer_id);
    checks.push({
      name: "issuer_known",
      ok: !!issuer,
      detail: issuer ? undefined : "unknown issuer",
    });

    const { signature, ...unsigned } = event;
    const sigOk =
      !!issuer &&
      verifyEventSignature(unsigned, signature, issuer.public_key);
    checks.push({ name: "signature", ok: sigOk });

    const authOk =
      !!issuer && issuer.allowed_event_types.includes(event.event_type);
    checks.push({ name: "issuer_authorization", ok: authOk });

    checks.push({ name: "ledger_inclusion", ok: true });

    return { valid: checks.every((c) => c.ok), checks };
  }

  // ── Client helpers ─────────────────────────────────────────────────

  buildUnsignedEvent(input: {
    identity_id: string;
    event_type: CoreEventType;
    issuer_id: string;
    timestamp?: number;
    payload_hash: string;
    proof_reference?: string | null;
  }): UnsignedEvent {
    const state = this.identityStates.get(input.identity_id);
    const sequence = (state?.last_sequence ?? 0) + 1;
    const previous_event =
      sequence === 1 ? null : (state?.last_event_id ?? null);
    const timestamp = input.timestamp ?? nowSeconds(this.clock);
    const draft = {
      identity_id: input.identity_id,
      event_type: input.event_type,
      issuer_id: input.issuer_id,
      timestamp,
      sequence,
      previous_event,
      payload_hash: input.payload_hash,
    };
    return {
      event_id: deriveEventId(draft),
      ...draft,
      proof: {
        type: "issuer_attestation",
        reference: input.proof_reference ?? null,
      },
      protocol_version: PROTOCOL_VERSION,
    };
  }

  signAndBuildEvent(
    input: Parameters<LoyaltyNode["buildUnsignedEvent"]>[0],
    issuerPrivateKey: Uint8Array,
  ): ProtocolEvent {
    const unsigned = this.buildUnsignedEvent(input);
    return { ...unsigned, signature: signEvent(unsigned, issuerPrivateKey) };
  }

  // ── Internals ──────────────────────────────────────────────────────

  private validateEvent(event: ProtocolEvent): void {
    if (event.protocol_version !== PROTOCOL_VERSION) {
      throw new ProtocolError("INVALID_PROTOCOL_VERSION");
    }

    if (
      typeof event.event_id !== "string" ||
      typeof event.identity_id !== "string" ||
      typeof event.issuer_id !== "string" ||
      typeof event.timestamp !== "number" ||
      !Number.isInteger(event.timestamp) ||
      typeof event.sequence !== "number" ||
      !Number.isInteger(event.sequence) ||
      typeof event.payload_hash !== "string" ||
      typeof event.signature !== "string" ||
      !event.proof ||
      typeof event.proof !== "object"
    ) {
      throw new ProtocolError("MALFORMED_EVENT");
    }

    if (!isCoreEventType(event.event_type)) {
      throw new ProtocolError("INVALID_EVENT_TYPE");
    }

    if (this.eventIndex.has(event.event_id)) {
      throw new ProtocolError("DUPLICATE_EVENT");
    }

    const identity = this.identities.get(event.identity_id);
    if (!identity) {
      throw new ProtocolError("UNKNOWN_IDENTITY");
    }
    if (identity.status !== "active") {
      throw new ProtocolError("REVOKED_IDENTITY");
    }

    const issuer = this.issuers.get(event.issuer_id);
    if (!issuer) {
      throw new ProtocolError("UNKNOWN_ISSUER");
    }
    if (issuer.status !== "active") {
      throw new ProtocolError("UNAUTHORIZED_ISSUER");
    }
    if (!issuer.allowed_event_types.includes(event.event_type)) {
      throw new ProtocolError("UNAUTHORIZED_ISSUER");
    }

    if (!PAYLOAD_HASH_RE.test(event.payload_hash)) {
      throw new ProtocolError("INVALID_PROOF");
    }
    if (event.proof.type !== "issuer_attestation") {
      throw new ProtocolError("INVALID_PROOF");
    }

    const { signature, ...unsigned } = event;
    if (!verifyEventSignature(unsigned, signature, issuer.public_key)) {
      throw new ProtocolError("INVALID_SIGNATURE");
    }

    const state = this.identityStates.get(event.identity_id);
    const lastSequence = state?.last_sequence ?? 0;
    const lastEventId = state?.last_event_id ?? null;
    const expectedSequence = lastSequence + 1;

    if (event.sequence !== expectedSequence) {
      throw new ProtocolError("INVALID_SEQUENCE");
    }
    if (event.sequence === 1) {
      if (event.previous_event !== null) {
        throw new ProtocolError("INVALID_SEQUENCE");
      }
    } else if (event.previous_event !== lastEventId) {
      throw new ProtocolError("INVALID_SEQUENCE");
    }

    if (this.replayKeys.has(this.replayKey(event))) {
      throw new ProtocolError("REPLAY_DETECTED");
    }

    const now = nowSeconds(this.clock);
    if (event.timestamp < now - 86400 || event.timestamp > now + 300) {
      throw new ProtocolError("INVALID_TIMESTAMP");
    }

    if (
      event.event_type === "MEMBERSHIP_STARTED" &&
      state?.membership_active === true
    ) {
      throw new ProtocolError("INVALID_STATE_TRANSITION");
    }
  }

  private applyTransition(state: IdentityState, event: ProtocolEvent): void {
    switch (event.event_type) {
      case "ATTENDED_MATCH":
        state.match_attendance_count += 1;
        break;
      case "MEMBERSHIP_STARTED":
        state.membership_active = true;
        state.membership_started_at = event.timestamp;
        break;
      case "PURCHASE_COMPLETED":
        state.purchase_count += 1;
        break;
      case "JOINED_LIVE":
        state.live_join_count += 1;
        break;
      case "CREATED_CONTENT":
        state.content_created_count += 1;
        break;
      case "JOINED_COMMUNITY":
        state.community_join_count += 1;
        break;
      case "ACHIEVEMENT_GRANTED":
        state.achievement_count += 1;
        break;
      case "POLL_VOTED":
        state.poll_vote_count += 1;
        break;
    }
    state.last_sequence = event.sequence;
    state.last_event_id = event.event_id;
  }

  private getOrCreateIdentityState(identityId: string): IdentityState {
    let state = this.identityStates.get(identityId);
    if (!state) {
      state = emptyIdentityState(identityId);
      this.identityStates.set(identityId, state);
    }
    return state;
  }

  private replayKey(event: ProtocolEvent): string {
    return [
      event.issuer_id,
      event.identity_id,
      event.event_type,
      String(event.timestamp),
      event.payload_hash,
    ].join("|");
  }

  private buildCanonicalState(): CanonicalState {
    const identities = [...this.identities.values()]
      .map((i) => structuredClone(i))
      .sort((a, b) => a.identity_id.localeCompare(b.identity_id));
    const issuers = [...this.issuers.values()]
      .map((i) => structuredClone(i))
      .sort((a, b) => a.issuer_id.localeCompare(b.issuer_id));
    const identity_states = [...this.identityStates.values()]
      .filter((s) => s.last_sequence > 0)
      .map((s) => structuredClone(s))
      .sort((a, b) => a.identity_id.localeCompare(b.identity_id));

    return {
      protocol_version: PROTOCOL_VERSION,
      identities,
      issuers,
      identity_states,
      ledger_height: this.ledger.length,
      last_ledger_event_id:
        this.ledger.length === 0
          ? null
          : this.ledger[this.ledger.length - 1]!.event_id,
    };
  }

  private computeStateRoot(): string {
    return stateRootHex(this.buildCanonicalState());
  }

  private recomputeRoot(): void {
    this.stateRoot = this.computeStateRoot();
  }

  private requireIdentity(identityId: string): Identity {
    const identity = this.identities.get(identityId);
    if (!identity) throw new ProtocolError("UNKNOWN_IDENTITY");
    return identity;
  }

  private requireIssuer(issuerId: string): Issuer {
    const issuer = this.issuers.get(issuerId);
    if (!issuer) throw new ProtocolError("UNKNOWN_ISSUER");
    return issuer;
  }
}
