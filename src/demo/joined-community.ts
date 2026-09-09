import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("JOINED_COMMUNITY");

const ctx = createDemo(["footballClub"]);
submitEvent(ctx, "JOINED_COMMUNITY", ctx.club.issuerId, ctx.club.keys, {
  community_id: "nu_official_supporters",
});
printState(ctx, ["community_join_count"]);
