import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("MEMBERSHIP_STARTED");

const ctx = createDemo(["footballClub"]);
submitEvent(ctx, "MEMBERSHIP_STARTED", ctx.club.issuerId, ctx.club.keys, {
  membership_tier: "season_2026_27",
});
printState(ctx, ["membership_active"]);
