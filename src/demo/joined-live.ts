import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("JOINED_LIVE");

const ctx = createDemo(["fanPlatform"]);
submitEvent(ctx, "JOINED_LIVE", ctx.platform.issuerId, ctx.platform.keys, {
  live_id: "matchday_watchalong_906",
  dwell_seconds: 900,
});
printState(ctx, ["live_join_count"]);
