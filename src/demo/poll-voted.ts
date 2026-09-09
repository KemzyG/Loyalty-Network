import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("POLL_VOTED");

const ctx = createDemo(["footballClub"]);
submitEvent(ctx, "POLL_VOTED", ctx.club.issuerId, ctx.club.keys, {
  poll_id: "motm_2026_09_06",
  option_id: "player_17",
});
printState(ctx, ["poll_vote_count"]);
