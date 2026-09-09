import {
  generateKeyPair,
  ISSUER_ROLE_TYPES,
  LoyaltyNode,
  payloadHashOf,
  PROTOCOL_VERSION,
  type CoreEventType,
  type IdentityState,
  type KeyPair,
} from "../index.js";

export type DemoIssuerKind = "footballClub" | "clubShop" | "fanPlatform";

export interface DemoContext {
  node: LoyaltyNode;
  identityId: string;
  club: { issuerId: string; keys: KeyPair };
  shop: { issuerId: string; keys: KeyPair };
  platform: { issuerId: string; keys: KeyPair };
}

const ORG: Record<DemoIssuerKind, string> = {
  footballClub: "North United FC",
  clubShop: "North United Club Shop",
  fanPlatform: "MadFan",
};

/** Fresh in-memory node with supporter identity + role issuers. */
export function createDemo(kinds: DemoIssuerKind[] = ["footballClub", "clubShop", "fanPlatform"]): DemoContext {
  const clockMs = Date.now();
  const node = new LoyaltyNode({ clock: () => clockMs });
  const supporter = generateKeyPair();
  const identity = node.createIdentity(supporter.publicKeyBase64);

  const clubKeys = generateKeyPair();
  const shopKeys = generateKeyPair();
  const platformKeys = generateKeyPair();

  const club = {
    issuerId: kinds.includes("footballClub")
      ? node.registerIssuer(ORG.footballClub, clubKeys.publicKeyBase64, [
          ...ISSUER_ROLE_TYPES.footballClub,
        ]).issuer_id
      : "",
    keys: clubKeys,
  };
  const shop = {
    issuerId: kinds.includes("clubShop")
      ? node.registerIssuer(ORG.clubShop, shopKeys.publicKeyBase64, [
          ...ISSUER_ROLE_TYPES.clubShop,
        ]).issuer_id
      : "",
    keys: shopKeys,
  };
  const platform = {
    issuerId: kinds.includes("fanPlatform")
      ? node.registerIssuer(ORG.fanPlatform, platformKeys.publicKeyBase64, [
          ...ISSUER_ROLE_TYPES.fanPlatform,
        ]).issuer_id
      : "",
    keys: platformKeys,
  };

  return { node, identityId: identity.identity_id, club, shop, platform };
}

export function submitEvent(
  ctx: DemoContext,
  event_type: CoreEventType,
  issuerId: string,
  signer: KeyPair,
  payload: Record<string, unknown>,
): string {
  const event = ctx.node.signAndBuildEvent(
    {
      identity_id: ctx.identityId,
      issuer_id: issuerId,
      event_type,
      payload_hash: payloadHashOf(JSON.stringify(payload)),
    },
    signer.privateKey,
  );
  const result = ctx.node.submitEvent(event);
  console.log(`✓ ${event_type} → height ${result.ledger_height}`);
  return event.event_id;
}

export function printHeader(title: string): void {
  console.log(`Loyalty Protocol v${PROTOCOL_VERSION} — ${title}\n`);
}

export function printState(ctx: DemoContext, focus?: (keyof IdentityState)[]): void {
  const state = ctx.node.getIdentityState(ctx.identityId);
  const base: Record<string, unknown> = {
    identity_id: ctx.identityId,
    last_sequence: state?.last_sequence,
    ledger_height: ctx.node.getLedgerHeight(),
    state_root: ctx.node.getStateRoot(),
  };

  const counters: (keyof IdentityState)[] = focus ?? [
    "match_attendance_count",
    "membership_active",
    "purchase_count",
    "community_join_count",
    "achievement_count",
    "poll_vote_count",
    "live_join_count",
    "content_created_count",
  ];

  for (const key of counters) {
    base[key] = state?.[key];
  }

  console.log("\nIdentity state:");
  console.log(base);
}
