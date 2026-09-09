import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleRequest, type GatewayContext } from "../src/gateway/http.js";
import { LoyaltyNode } from "../src/node.js";
import { saveNode } from "../src/gateway/persist.js";

const FIXED_MS = 1_757_059_200_000;

describe("HTTP Protocol Gateway", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let dataPath: string;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "loyalty-gw-"));
    dataPath = join(dir, "snapshot.json");
    const node = new LoyaltyNode({ clock: () => FIXED_MS });
    await saveNode(dataPath, node);

    const ctx: GatewayContext = {
      node,
      dataPath,
      adminToken: null,
      disableDev: false,
    };

    const server = createServer((req, res) => {
      void handleRequest(ctx, req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  afterAll(async () => {
    await close();
    await rm(join(dataPath, ".."), { recursive: true, force: true });
  });

  async function json(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it("health check", async () => {
    const res = await json("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /identities lists identities", async () => {
    const listed = await json("GET", "/identities");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.identities)).toBe(true);
  });

  it("dev routes return 404 when disableDev is true", async () => {
    // Spin a short-lived server with dev disabled
    const { createServer } = await import("node:http");
    const { LoyaltyNode } = await import("../src/node.js");
    const { handleRequest } = await import("../src/gateway/http.js");
    const node = new LoyaltyNode({ clock: () => FIXED_MS });
    const ctx = {
      node,
      dataPath: ":memory:",
      adminToken: null,
      disableDev: true,
    };
    const server = createServer((req, res) => {
      void handleRequest(ctx, req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/dev/keypair`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("ATTENDED_MATCH vertical slice over HTTP", async () => {
    const fan = await json("POST", "/dev/keypair");
    const club = await json("POST", "/dev/keypair");

    const identity = await json("POST", "/identities", {
      public_key: fan.body.public_key,
    });
    expect(identity.status).toBe(201);

    const issuer = await json("POST", "/issuers", {
      organization: "North United FC",
      public_key: club.body.public_key,
      allowed_event_types: ["ATTENDED_MATCH", "MEMBERSHIP_STARTED"],
    });
    expect(issuer.status).toBe(201);

    const prepared = await json("POST", "/events/prepare", {
      identity_id: identity.body.identity_id,
      issuer_id: issuer.body.issuer_id,
      event_type: "ATTENDED_MATCH",
      payload: "match-42",
    });
    expect(prepared.status).toBe(200);

    const signed = await json("POST", "/dev/sign-event", {
      event: prepared.body,
      private_key: club.body.private_key,
    });
    expect(signed.status).toBe(200);

    const submitted = await json("POST", "/events", signed.body);
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("ACCEPTED");
    expect(submitted.body.ledger_height).toBe(1);

    const state = await json(
      "GET",
      `/identities/${identity.body.identity_id}/state`,
    );
    expect(state.body.match_attendance_count).toBe(1);

    const root = await json("GET", "/state/root");
    expect(root.body.state_root).toBe(submitted.body.state_root);

    const replay = await json("POST", "/state/replay-check");
    expect(replay.status).toBe(200);
    expect(replay.body.matches).toBe(true);
    expect(replay.body.state_root).toBe(submitted.body.state_root);
  });

  it("admin token required when configured", async () => {
    const { createServer } = await import("node:http");
    const { LoyaltyNode } = await import("../src/node.js");
    const { handleRequest } = await import("../src/gateway/http.js");
    const dir = await mkdtemp(join(tmpdir(), "loyalty-admin-"));
    const adminDataPath = join(dir, "snapshot.json");
    const node = new LoyaltyNode({ clock: () => FIXED_MS });
    const ctx = {
      node,
      dataPath: adminDataPath,
      adminToken: "secret-admin",
      disableDev: false,
    };
    const server = createServer((req, res) => {
      void handleRequest(ctx, req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}`;

    try {
      const denied = await fetch(`${url}/identities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_key: "x" }),
      });
      expect(denied.status).toBe(401);
      expect((await denied.json()).error).toBe("UNAUTHORIZED");

      const keys = await fetch(`${url}/dev/keypair`, {
        method: "POST",
        headers: { "X-Admin-Token": "secret-admin" },
      });
      expect(keys.status).toBe(201);
      const keyBody = (await keys.json()) as { public_key: string };

      const created = await fetch(`${url}/identities`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Admin-Token": "secret-admin",
        },
        body: JSON.stringify({ public_key: keyBody.public_key }),
      });
      expect(created.status).toBe(201);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists snapshot and reloads via loadNode", async () => {
    const fan = await json("POST", "/dev/keypair");
    const identity = await json("POST", "/identities", {
      public_key: fan.body.public_key,
    });
    expect(identity.status).toBe(201);

    const { loadNode } = await import("../src/gateway/persist.js");
    const reloaded = await loadNode(dataPath, () => FIXED_MS);
    const found = reloaded.getIdentity(identity.body.identity_id);
    expect(found?.public_key).toBe(fan.body.public_key);
  });

  it("POST /events maps ProtocolError to 400 JSON", async () => {
    const fan = await json("POST", "/dev/keypair");
    const club = await json("POST", "/dev/keypair");
    const identity = await json("POST", "/identities", {
      public_key: fan.body.public_key,
    });
    const issuer = await json("POST", "/issuers", {
      organization: "Error Path FC",
      public_key: club.body.public_key,
      allowed_event_types: ["ATTENDED_MATCH"],
    });
    const prepared = await json("POST", "/events/prepare", {
      identity_id: identity.body.identity_id,
      issuer_id: issuer.body.issuer_id,
      event_type: "ATTENDED_MATCH",
      payload: "dup-test",
    });
    const signed = await json("POST", "/dev/sign-event", {
      event: prepared.body,
      private_key: club.body.private_key,
    });
    const first = await json("POST", "/events", signed.body);
    expect(first.status).toBe(201);

    const dup = await json("POST", "/events", signed.body);
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe("DUPLICATE_EVENT");
  });

  it("GET identity state is 404 before first event", async () => {
    const fan = await json("POST", "/dev/keypair");
    const identity = await json("POST", "/identities", {
      public_key: fan.body.public_key,
    });
    const state = await json(
      "GET",
      `/identities/${identity.body.identity_id}/state`,
    );
    expect(state.status).toBe(404);
    expect(state.body.error).toBe("NOT_FOUND");
  });
});
