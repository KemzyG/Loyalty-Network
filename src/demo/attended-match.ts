import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("ATTENDED_MATCH");

const ctx = createDemo(["footballClub"]);
submitEvent(ctx, "ATTENDED_MATCH", ctx.club.issuerId, ctx.club.keys, {
  match_id: "nu_vs_rovers_2026_09_06",
  competition: "league",
  venue: "home",
});
printState(ctx, ["match_attendance_count"]);
