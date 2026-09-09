import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  LoyaltyNode,
  payloadHashOf,
  ProtocolError,
  signEvent,
  type ProtocolEvent,
  type UnsignedEvent,
} from "../src/index.js";

const FIXED_MS = 1_757_059_200_000;
const NOW_SEC = Math.floor(FIXED_MS / 1000);

function freshNode(clockMs = FIXED_MS): LoyaltyNode {
  return new LoyaltyNode({ clock: () => clockMs });
}

function setupClubFan(node: LoyaltyNode) {
  const fan = generateKeyPair();
  const club = generateKeyPair();
  const identity = node.createIdentity(fan.publicKeyBase64);
  const issuer = node.registerIssuer("North United FC", club.publicKeyBase64, [
    "ATTENDED_MATCH",
    "MEMBERSHIP_STARTED",
    "JOINED_COMMUNITY",
    "PURCHASE_COMPLETED",
  ]);
  return { fan, club, identity, issuer };
}

function expectCode(fn: () => void, code: string) {
  try {
    fn();
    expect.fail(`expected ProtocolError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).code).toBe(code);
  }
}

function resign(event: ProtocolEvent, privateKey: Uint8Array): ProtocolEvent {
  const { signature: _s, ...unsigned } = event;
  return {
    ...unsigned,
    signature: signEvent(unsigned as UnsignedEvent, privateKey),
  };
}

describe("protocol error paths", () => {
  it("UNKNOWN_IDENTITY", () => {
    const node = freshNode();
    const { club, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: "id_DOESNOTEXIST0000000000000",
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("x"),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "UNKNOWN_IDENTITY");
  });

  it("UNKNOWN_ISSUER", () => {
    const node = freshNode();
    const { club, identity } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: "issuer_DOESNOTEXIST000000000",
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("x"),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "UNKNOWN_ISSUER");
  });

  it("suspended identity → REVOKED_IDENTITY", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    node.suspendIdentity(identity.identity_id);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "REVOKED_IDENTITY");
  });

  it("suspended issuer → UNAUTHORIZED_ISSUER", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    node.suspendIssuer(issuer.issuer_id);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "UNAUTHORIZED_ISSUER");
  });

  it("MALFORMED_EVENT (non-integer timestamp)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    event.timestamp = NOW_SEC + 0.5;
    expectCode(() => node.submitEvent(event), "MALFORMED_EVENT");
  });

  it("INVALID_PROTOCOL_VERSION", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    const bad = resign(
      { ...event, protocol_version: "0.1" as "0.4" },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(bad), "INVALID_PROTOCOL_VERSION");
  });

  it("INVALID_PROOF (bad payload_hash format)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    const bad = resign({ ...event, payload_hash: "not-a-hash" }, club.privateKey);
    expectCode(() => node.submitEvent(bad), "INVALID_PROOF");
  });

  it("INVALID_PROOF (wrong proof.type)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    const bad = resign(
      {
        ...event,
        proof: { type: "other" as "issuer_attestation", reference: null },
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(bad), "INVALID_PROOF");
  });

  it("INVALID_TIMESTAMP (too old)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("old"),
        timestamp: NOW_SEC - 86401,
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "INVALID_TIMESTAMP");
  });

  it("INVALID_TIMESTAMP (too far in future)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("future"),
        timestamp: NOW_SEC + 301,
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "INVALID_TIMESTAMP");
  });

  it("REPLAY_DETECTED (same issuer/identity/type/timestamp/payload, new sequence)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const hash = payloadHashOf("same-payload");
    const first = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: hash,
        timestamp: NOW_SEC,
      },
      club.privateKey,
    );
    node.submitEvent(first);

    const second = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: hash,
        timestamp: NOW_SEC,
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(second), "REPLAY_DETECTED");
  });

  it("INVALID_SEQUENCE (seq 1 with non-null previous_event)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    const bad = resign(
      { ...event, previous_event: "evt_FAKEPREVIOUS0000" },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(bad), "INVALID_SEQUENCE");
  });

  it("INVALID_SEQUENCE (wrong previous_event on seq 2)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const first = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("a"),
      },
      club.privateKey,
    );
    node.submitEvent(first);

    const second = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("b"),
      },
      club.privateKey,
    );
    const bad = resign(
      { ...second, previous_event: "evt_WRONGPREVIOUS000" },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(bad), "INVALID_SEQUENCE");
  });

  it("ALREADY_EXISTS for duplicate identity and issuer public keys", () => {
    const node = freshNode();
    const fan = generateKeyPair();
    const club = generateKeyPair();
    node.createIdentity(fan.publicKeyBase64);
    expectCode(() => node.createIdentity(fan.publicKeyBase64), "ALREADY_EXISTS");

    node.registerIssuer("Club A", club.publicKeyBase64, ["ATTENDED_MATCH"]);
    expectCode(
      () => node.registerIssuer("Club B", club.publicKeyBase64, ["ATTENDED_MATCH"]),
      "ALREADY_EXISTS",
    );
  });

  it("PURCHASE_COMPLETED and JOINED_COMMUNITY update counters", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);

    node.submitEvent(
      node.signAndBuildEvent(
        {
          identity_id: identity.identity_id,
          issuer_id: issuer.issuer_id,
          event_type: "PURCHASE_COMPLETED",
          payload_hash: payloadHashOf("order-1"),
        },
        club.privateKey,
      ),
    );
    node.submitEvent(
      node.signAndBuildEvent(
        {
          identity_id: identity.identity_id,
          issuer_id: issuer.issuer_id,
          event_type: "JOINED_COMMUNITY",
          payload_hash: payloadHashOf("community-1"),
        },
        club.privateKey,
      ),
    );

    const state = node.getIdentityState(identity.identity_id)!;
    expect(state.purchase_count).toBe(1);
    expect(state.community_join_count).toBe(1);
  });

  it("rotate identity key keeps identity_id and blocks reuse of old pubkey", () => {
    const node = freshNode();
    const fan = generateKeyPair();
    const rotated = generateKeyPair();
    const identity = node.createIdentity(fan.publicKeyBase64);
    const updated = node.rotateIdentityKey(
      identity.identity_id,
      rotated.publicKeyBase64,
    );
    expect(updated.identity_id).toBe(identity.identity_id);
    expect(updated.public_key).toBe(rotated.publicKeyBase64);
    expectCode(() => node.createIdentity(fan.publicKeyBase64), "ALREADY_EXISTS");
  });

  it("timestamp window edges are accepted (±86400 / +300)", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);

    node.submitEvent(
      node.signAndBuildEvent(
        {
          identity_id: identity.identity_id,
          issuer_id: issuer.issuer_id,
          event_type: "ATTENDED_MATCH",
          payload_hash: payloadHashOf("edge-old"),
          timestamp: NOW_SEC - 86400,
        },
        club.privateKey,
      ),
    );
    node.submitEvent(
      node.signAndBuildEvent(
        {
          identity_id: identity.identity_id,
          issuer_id: issuer.issuer_id,
          event_type: "ATTENDED_MATCH",
          payload_hash: payloadHashOf("edge-future"),
          timestamp: NOW_SEC + 300,
        },
        club.privateKey,
      ),
    );

    expect(node.getIdentityState(identity.identity_id)?.match_attendance_count).toBe(
      2,
    );
  });
});
