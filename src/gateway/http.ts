import type { IncomingMessage, ServerResponse } from "node:http";
import { ProtocolError } from "../errors.js";
import {
  decodePrivateKey,
  generateKeyPair,
  payloadHashOf,
  signEvent,
} from "../crypto.js";
import type { LoyaltyNode } from "../node.js";
import type { CoreEventType, ProtocolEvent } from "../types.js";
import { CORE_EVENT_TYPES, DOMAIN_FOCUS, PROTOCOL_VERSION } from "../types.js";
import { saveNode } from "./persist.js";

export interface GatewayContext {
  node: LoyaltyNode;
  dataPath: string;
  adminToken: string | null;
  /** When true, /dev/* routes return 404. */
  disableDev: boolean;
}

type Handler = (
  ctx: GatewayContext,
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function requireAdmin(
  ctx: GatewayContext,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!ctx.adminToken) return true;
  const header = req.headers["x-admin-token"];
  if (header === ctx.adminToken) return true;
  writeJson(res, 401, {
    error: "UNAUTHORIZED",
    message: "invalid or missing X-Admin-Token",
  });
  return false;
}

/** Dev helpers: require admin (if configured) and reject when disabled. */
function requireDev(
  ctx: GatewayContext,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (ctx.disableDev) {
    writeJson(res, 404, { error: "NOT_FOUND", message: "dev routes disabled" });
    return false;
  }
  return requireAdmin(ctx, req, res);
}

async function persist(ctx: GatewayContext): Promise<void> {
  await saveNode(ctx.dataPath, ctx.node);
}

function isCoreEventType(value: unknown): value is CoreEventType {
  return (
    typeof value === "string" &&
    (CORE_EVENT_TYPES as readonly string[]).includes(value)
  );
}

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: "GET",
    pattern: /^\/health$/,
    handler: async (_ctx, _req, res) => {
      writeJson(res, 200, {
        ok: true,
        protocol_version: PROTOCOL_VERSION,
        domain_focus: DOMAIN_FOCUS,
      });
    },
  },

  // Identities
  {
    method: "GET",
    pattern: /^\/identities$/,
    handler: async (ctx, _req, res) => {
      writeJson(res, 200, { identities: ctx.node.getCanonicalState().identities });
    },
  },
  {
    method: "POST",
    pattern: /^\/identities$/,
    handler: async (ctx, req, res) => {
      if (!requireAdmin(ctx, req, res)) return;
      const body = (await readJson(req)) as { public_key?: string };
      if (!body.public_key) {
        writeJson(res, 400, { error: "INVALID_REQUEST", message: "public_key required" });
        return;
      }
      const identity = ctx.node.createIdentity(body.public_key);
      await persist(ctx);
      writeJson(res, 201, identity);
    },
  },
  {
    method: "GET",
    pattern: /^\/identities\/([^/]+)$/,
    handler: async (ctx, _req, res, params) => {
      const identity = ctx.node.getIdentity(params.id!);
      if (!identity) {
        writeJson(res, 404, { error: "NOT_FOUND" });
        return;
      }
      writeJson(res, 200, identity);
    },
  },
  {
    method: "GET",
    pattern: /^\/identities\/([^/]+)\/state$/,
    handler: async (ctx, _req, res, params) => {
      const state = ctx.node.getIdentityState(params.id!);
      if (!state) {
        writeJson(res, 404, { error: "NOT_FOUND" });
        return;
      }
      writeJson(res, 200, state);
    },
  },
  {
    method: "POST",
    pattern: /^\/identities\/([^/]+)\/rotate$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const body = (await readJson(req)) as { public_key?: string };
      if (!body.public_key) {
        writeJson(res, 400, { error: "INVALID_REQUEST", message: "public_key required" });
        return;
      }
      const identity = ctx.node.rotateIdentityKey(params.id!, body.public_key);
      await persist(ctx);
      writeJson(res, 200, identity);
    },
  },
  {
    method: "POST",
    pattern: /^\/identities\/([^/]+)\/suspend$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const identity = ctx.node.suspendIdentity(params.id!);
      await persist(ctx);
      writeJson(res, 200, identity);
    },
  },
  {
    method: "POST",
    pattern: /^\/identities\/([^/]+)\/revoke$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const identity = ctx.node.revokeIdentity(params.id!);
      await persist(ctx);
      writeJson(res, 200, identity);
    },
  },

  // Issuers
  {
    method: "GET",
    pattern: /^\/issuers$/,
    handler: async (ctx, _req, res) => {
      writeJson(res, 200, { issuers: ctx.node.getCanonicalState().issuers });
    },
  },
  {
    method: "POST",
    pattern: /^\/issuers$/,
    handler: async (ctx, req, res) => {
      if (!requireAdmin(ctx, req, res)) return;
      const body = (await readJson(req)) as {
        organization?: string;
        public_key?: string;
        allowed_event_types?: string[];
      };
      if (!body.organization || !body.public_key || !body.allowed_event_types) {
        writeJson(res, 400, {
          error: "INVALID_REQUEST",
          message: "organization, public_key, allowed_event_types required",
        });
        return;
      }
      if (!body.allowed_event_types.every(isCoreEventType)) {
        writeJson(res, 400, { error: "INVALID_EVENT_TYPE" });
        return;
      }
      const issuer = ctx.node.registerIssuer(
        body.organization,
        body.public_key,
        body.allowed_event_types,
      );
      await persist(ctx);
      writeJson(res, 201, issuer);
    },
  },
  {
    method: "GET",
    pattern: /^\/issuers\/([^/]+)$/,
    handler: async (ctx, _req, res, params) => {
      const issuer = ctx.node.getIssuer(params.id!);
      if (!issuer) {
        writeJson(res, 404, { error: "NOT_FOUND" });
        return;
      }
      writeJson(res, 200, issuer);
    },
  },
  {
    method: "PATCH",
    pattern: /^\/issuers\/([^/]+)\/permissions$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const body = (await readJson(req)) as { allowed_event_types?: string[] };
      if (!body.allowed_event_types?.every(isCoreEventType)) {
        writeJson(res, 400, { error: "INVALID_EVENT_TYPE" });
        return;
      }
      const issuer = ctx.node.updateIssuerPermissions(
        params.id!,
        body.allowed_event_types,
      );
      await persist(ctx);
      writeJson(res, 200, issuer);
    },
  },
  {
    method: "POST",
    pattern: /^\/issuers\/([^/]+)\/suspend$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const issuer = ctx.node.suspendIssuer(params.id!);
      await persist(ctx);
      writeJson(res, 200, issuer);
    },
  },
  {
    method: "POST",
    pattern: /^\/issuers\/([^/]+)\/revoke$/,
    handler: async (ctx, req, res, params) => {
      if (!requireAdmin(ctx, req, res)) return;
      const issuer = ctx.node.revokeIssuer(params.id!);
      await persist(ctx);
      writeJson(res, 200, issuer);
    },
  },

  // Events
  {
    method: "POST",
    pattern: /^\/events\/prepare$/,
    handler: async (ctx, req, res) => {
      const body = (await readJson(req)) as {
        identity_id?: string;
        issuer_id?: string;
        event_type?: string;
        payload_hash?: string;
        payload?: string;
        timestamp?: number;
        proof_reference?: string | null;
      };
      if (!body.identity_id || !body.issuer_id || !body.event_type) {
        writeJson(res, 400, {
          error: "INVALID_REQUEST",
          message: "identity_id, issuer_id, event_type required",
        });
        return;
      }
      if (!isCoreEventType(body.event_type)) {
        writeJson(res, 400, { error: "INVALID_EVENT_TYPE" });
        return;
      }
      const payload_hash =
        body.payload_hash ?? payloadHashOf(body.payload ?? "");
      const unsigned = ctx.node.buildUnsignedEvent({
        identity_id: body.identity_id,
        issuer_id: body.issuer_id,
        event_type: body.event_type,
        payload_hash,
        timestamp: body.timestamp,
        proof_reference: body.proof_reference,
      });
      writeJson(res, 200, unsigned);
    },
  },
  {
    method: "POST",
    pattern: /^\/events$/,
    handler: async (ctx, req, res) => {
      const body = (await readJson(req)) as ProtocolEvent;
      const result = ctx.node.submitEvent(body);
      await persist(ctx);
      writeJson(res, 201, result);
    },
  },
  {
    method: "GET",
    pattern: /^\/events\/([^/]+)$/,
    handler: async (ctx, _req, res, params) => {
      const event = ctx.node.getEvent(params.id!);
      if (!event) {
        writeJson(res, 404, { error: "NOT_FOUND" });
        return;
      }
      writeJson(res, 200, event);
    },
  },
  {
    method: "POST",
    pattern: /^\/events\/([^/]+)\/verify$/,
    handler: async (ctx, _req, res, params) => {
      writeJson(res, 200, ctx.node.verifyEvent(params.id!));
    },
  },

  // State
  {
    method: "GET",
    pattern: /^\/state$/,
    handler: async (ctx, _req, res) => {
      writeJson(res, 200, ctx.node.getCanonicalState());
    },
  },
  {
    method: "GET",
    pattern: /^\/state\/root$/,
    handler: async (ctx, _req, res) => {
      writeJson(res, 200, { state_root: ctx.node.getStateRoot() });
    },
  },
  {
    method: "GET",
    pattern: /^\/state\/height$/,
    handler: async (ctx, _req, res) => {
      writeJson(res, 200, { ledger_height: ctx.node.getLedgerHeight() });
    },
  },
  {
    method: "POST",
    pattern: /^\/state\/replay-check$/,
    handler: async (ctx, req, res) => {
      if (!requireAdmin(ctx, req, res)) return;
      writeJson(res, 200, ctx.node.replayAndCheckRoot());
    },
  },

  // Dev helpers (local integration only)
  {
    method: "POST",
    pattern: /^\/dev\/keypair$/,
    handler: async (ctx, req, res) => {
      if (!requireDev(ctx, req, res)) return;
      const kp = generateKeyPair();
      writeJson(res, 201, {
        public_key: kp.publicKeyBase64,
        private_key: kp.privateKeyBase64,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/dev\/sign-event$/,
    handler: async (ctx, req, res) => {
      if (!requireDev(ctx, req, res)) return;
      const body = (await readJson(req)) as {
        event?: Omit<ProtocolEvent, "signature">;
        private_key?: string;
      };
      if (!body.event || !body.private_key) {
        writeJson(res, 400, {
          error: "INVALID_REQUEST",
          message: "event and private_key required",
        });
        return;
      }
      const signature = signEvent(
        body.event,
        decodePrivateKey(body.private_key),
      );
      writeJson(res, 200, { ...body.event, signature });
    },
  },
];

export async function handleRequest(
  ctx: GatewayContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      if (match[1]) params.id = decodeURIComponent(match[1]);
      await route.handler(ctx, req, res, params);
      return;
    }

    writeJson(res, 404, { error: "NOT_FOUND", path: url.pathname });
  } catch (err) {
    if (err instanceof ProtocolError) {
      writeJson(res, 400, { error: err.code, message: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      writeJson(res, 400, { error: "INVALID_JSON", message: err.message });
      return;
    }
    console.error(err);
    writeJson(res, 500, { error: "INTERNAL_ERROR" });
  }
}
