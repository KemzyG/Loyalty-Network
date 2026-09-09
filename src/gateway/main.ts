import { createServer } from "node:http";
import { resolve } from "node:path";
import { PROTOCOL_VERSION } from "../types.js";
import { handleRequest, type GatewayContext } from "./http.js";
import { loadLocalEnv } from "./loadEnv.js";
import { loadNode } from "./persist.js";

loadLocalEnv();

const PORT = Number(process.env.LOYALTY_PORT ?? 8787);
const HOST = process.env.LOYALTY_HOST ?? "127.0.0.1";
const DATA_PATH = resolve(
  process.env.LOYALTY_DATA_PATH ?? "./data/node-snapshot.json",
);
const ADMIN_TOKEN = process.env.LOYALTY_ADMIN_TOKEN ?? null;
const DISABLE_DEV =
  process.env.LOYALTY_DISABLE_DEV === "1" ||
  process.env.NODE_ENV === "production";

async function main(): Promise<void> {
  const node = await loadNode(DATA_PATH);
  const ctx: GatewayContext = {
    node,
    dataPath: DATA_PATH,
    adminToken: ADMIN_TOKEN,
    disableDev: DISABLE_DEV,
  };

  const server = createServer((req, res) => {
    void handleRequest(ctx, req, res);
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `Loyalty Protocol Gateway v${PROTOCOL_VERSION} listening on http://${HOST}:${PORT}`,
    );
    console.log(`data: ${DATA_PATH}`);
    console.log(
      `admin auth: ${ADMIN_TOKEN ? "X-Admin-Token required" : "disabled (dev)"}`,
    );
    console.log(`dev routes: ${DISABLE_DEV ? "disabled" : "enabled"}`);
    if (!ADMIN_TOKEN && HOST !== "127.0.0.1" && HOST !== "localhost") {
      console.warn(
        "warning: LOYALTY_ADMIN_TOKEN unset while binding non-localhost — registry APIs are open",
      );
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
