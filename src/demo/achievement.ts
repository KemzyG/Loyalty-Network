import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("ACHIEVEMENT_GRANTED");

const ctx = createDemo(["footballClub"]);
submitEvent(ctx, "ACHIEVEMENT_GRANTED", ctx.club.issuerId, ctx.club.keys, {
  achievement_id: "first_home_game_2026",
});
printState(ctx, ["achievement_count"]);
