import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

/** Runs one of each gated event type across club, shop, and MadFan. */
printHeader("all gated event types");

const ctx = createDemo();

submitEvent(ctx, "ATTENDED_MATCH", ctx.club.issuerId, ctx.club.keys, {
  match_id: "nu_vs_rovers_2026_09_06",
  competition: "league",
  venue: "home",
});
submitEvent(ctx, "MEMBERSHIP_STARTED", ctx.club.issuerId, ctx.club.keys, {
  membership_tier: "season_2026_27",
});
submitEvent(ctx, "JOINED_COMMUNITY", ctx.club.issuerId, ctx.club.keys, {
  community_id: "nu_official_supporters",
});
submitEvent(ctx, "ACHIEVEMENT_GRANTED", ctx.club.issuerId, ctx.club.keys, {
  achievement_id: "first_home_game_2026",
});
submitEvent(ctx, "POLL_VOTED", ctx.club.issuerId, ctx.club.keys, {
  poll_id: "motm_2026_09_06",
  option_id: "player_17",
});
submitEvent(ctx, "PURCHASE_COMPLETED", ctx.shop.issuerId, ctx.shop.keys, {
  order_id: "ord_88421",
  sku: "home_kit_26_27",
});
submitEvent(ctx, "JOINED_LIVE", ctx.platform.issuerId, ctx.platform.keys, {
  live_id: "matchday_watchalong_906",
  dwell_seconds: 900,
});
submitEvent(ctx, "CREATED_CONTENT", ctx.platform.issuerId, ctx.platform.keys, {
  content_id: "post_fan_cam_906",
  moderation: "approved",
});

printState(ctx);
