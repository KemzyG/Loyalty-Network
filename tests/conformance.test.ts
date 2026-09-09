import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  LoyaltyNode,
  payloadHashOf,
  ProtocolError,
  signEvent,
  type ProtocolEvent,
} from "../src/index.js";

const FIXED_MS = 1_757_059_200_000; // aligns with whitepaper example epoch

function freshNode(): LoyaltyNode {
  return new LoyaltyNode({ clock: () => FIXED_MS });
}

function setupClubFan(node: LoyaltyNode) {
  const fan = generateKeyPair();
  const club = generateKeyPair();
  const identity = node.createIdentity(fan.publicKeyBase64);
    const issuer = node.registerIssuer("North United FC", club.publicKeyBase64, [
      "ATTENDED_MATCH",
      "MEMBERSHIP_STARTED",
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

describe("PROTOCOL_SPEC_v0.4 conformance", () => {
  it("1. Determinism: identical genesis + stream → identical state_root", () => {
    const a = freshNode();
    const b = freshNode();

    const fan = generateKeyPair();
    const club = generateKeyPair();

    const idA = a.createIdentity(fan.publicKeyBase64);
    const idB = b.createIdentity(fan.publicKeyBase64);
    expect(idA.identity_id).toBe(idB.identity_id);

    const issA = a.registerIssuer("North United FC", club.publicKeyBase64, [
      "ATTENDED_MATCH",
      "MEMBERSHIP_STARTED",
    ]);
    const issB = b.registerIssuer("North United FC", club.publicKeyBase64, [
      "ATTENDED_MATCH",
      "MEMBERSHIP_STARTED",
    ]);
    expect(issA.issuer_id).toBe(issB.issuer_id);

    const event = a.signAndBuildEvent(
      {
        identity_id: idA.identity_id,
        issuer_id: issA.issuer_id,
        event_type: "ATTENDED_MATCH",
        payload_hash: payloadHashOf("match-1"),
      },
      club.privateKey,
    );

    a.submitEvent(event);
    b.submitEvent(structuredClone(event));

    expect(a.getStateRoot()).toBe(b.getStateRoot());
  });

  it("2. Duplicate reject: same event_id → DUPLICATE_EVENT", () => {
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
    node.submitEvent(event);
    expectCode(() => node.submitEvent(structuredClone(event)), "DUPLICATE_EVENT");
  });

  it("3. Unauthorized type: club without PURCHASE_COMPLETED → UNAUTHORIZED_ISSUER", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const event = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "PURCHASE_COMPLETED",
        payload_hash: payloadHashOf(""),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(event), "UNAUTHORIZED_ISSUER");
  });

  it("4. Bad signature: mutated field after signing → INVALID_SIGNATURE", () => {
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
    event.payload_hash = payloadHashOf("tampered");
    expectCode(() => node.submitEvent(event), "INVALID_SIGNATURE");
  });

  it("5. Sequence gap → INVALID_SEQUENCE", () => {
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
    const bad: ProtocolEvent = {
      ...event,
      sequence: 2,
      previous_event: "evt_DOESNOTEXIST",
      signature: "",
    };
    const { signature: _s, ...unsigned } = bad;
    bad.signature = signEvent(unsigned, club.privateKey);
    expectCode(() => node.submitEvent(bad), "INVALID_SEQUENCE");
  });

  it("6. Double membership → INVALID_STATE_TRANSITION", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const first = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "MEMBERSHIP_STARTED",
        payload_hash: payloadHashOf("m1"),
      },
      club.privateKey,
    );
    node.submitEvent(first);
    const second = node.signAndBuildEvent(
      {
        identity_id: identity.identity_id,
        issuer_id: issuer.issuer_id,
        event_type: "MEMBERSHIP_STARTED",
        payload_hash: payloadHashOf("m2"),
      },
      club.privateKey,
    );
    expectCode(() => node.submitEvent(second), "INVALID_STATE_TRANSITION");
  });

  it("7. Three ATTENDED_MATCH → match_attendance_count == 3", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    for (let i = 0; i < 3; i++) {
      const event = node.signAndBuildEvent(
        {
          identity_id: identity.identity_id,
          issuer_id: issuer.issuer_id,
          event_type: "ATTENDED_MATCH",
          payload_hash: payloadHashOf(`match-${i}`),
        },
        club.privateKey,
      );
      node.submitEvent(event);
    }
    expect(node.getIdentityState(identity.identity_id)?.match_attendance_count).toBe(
      3,
    );
  });

  it("7b. Gated engagement counters (JOINED_LIVE, CREATED_CONTENT, ACHIEVEMENT_GRANTED, POLL_VOTED)", () => {
    const node = freshNode();
    const fan = generateKeyPair();
    const platform = generateKeyPair();
    const identity = node.createIdentity(fan.publicKeyBase64);
    const issuer = node.registerIssuer("MadFan", platform.publicKeyBase64, [
      "JOINED_LIVE",
      "CREATED_CONTENT",
      "JOINED_COMMUNITY",
      "ACHIEVEMENT_GRANTED",
      "POLL_VOTED",
    ]);

    const types = [
      "JOINED_LIVE",
      "CREATED_CONTENT",
      "ACHIEVEMENT_GRANTED",
      "POLL_VOTED",
    ] as const;

    for (const event_type of types) {
      node.submitEvent(
        node.signAndBuildEvent(
          {
            identity_id: identity.identity_id,
            issuer_id: issuer.issuer_id,
            event_type,
            payload_hash: payloadHashOf(event_type),
          },
          platform.privateKey,
        ),
      );
    }

    const state = node.getIdentityState(identity.identity_id)!;
    expect(state.live_join_count).toBe(1);
    expect(state.content_created_count).toBe(1);
    expect(state.achievement_count).toBe(1);
    expect(state.poll_vote_count).toBe(1);
  });

  it("7c. Farmable social types are rejected as INVALID_EVENT_TYPE", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    const unsigned = node.buildUnsignedEvent({
      identity_id: identity.identity_id,
      issuer_id: issuer.issuer_id,
      event_type: "ATTENDED_MATCH",
      payload_hash: payloadHashOf("x"),
    });
    const bad = {
      ...unsigned,
      event_type: "LIKED" as unknown as "ATTENDED_MATCH",
      signature: "",
    };
    const { signature: _s, ...rest } = bad;
    bad.signature = signEvent(rest as typeof unsigned, club.privateKey);
    expectCode(() => node.submitEvent(bad as never), "INVALID_EVENT_TYPE");
  });

  it("8. Event after revoke → REVOKED_IDENTITY", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    node.revokeIdentity(identity.identity_id);
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

  it("9. ReplayAndCheckRoot after restart matches persisted state_root", () => {
    const node = freshNode();
    const { club, identity, issuer } = setupClubFan(node);
    for (let i = 0; i < 2; i++) {
      node.submitEvent(
        node.signAndBuildEvent(
          {
            identity_id: identity.identity_id,
            issuer_id: issuer.issuer_id,
            event_type: "ATTENDED_MATCH",
            payload_hash: payloadHashOf(`r-${i}`),
          },
          club.privateKey,
        ),
      );
    }
    const root = node.getStateRoot();
    const check = node.replayAndCheckRoot();
    expect(check.matches).toBe(true);
    expect(check.state_root).toBe(root);

    const restored = LoyaltyNode.fromSnapshot(node.exportSnapshot(), {
      clock: () => FIXED_MS,
    });
    expect(restored.getStateRoot()).toBe(root);
  });
});
