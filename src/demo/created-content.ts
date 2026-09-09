import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("CREATED_CONTENT");

const ctx = createDemo(["fanPlatform"]);
submitEvent(ctx, "CREATED_CONTENT", ctx.platform.issuerId, ctx.platform.keys, {
  content_id: "post_fan_cam_906",
  moderation: "approved",
});
printState(ctx, ["content_created_count"]);
