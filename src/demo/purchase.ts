import { createDemo, printHeader, printState, submitEvent } from "./harness.js";

printHeader("PURCHASE_COMPLETED");

const ctx = createDemo(["clubShop"]);
submitEvent(ctx, "PURCHASE_COMPLETED", ctx.shop.issuerId, ctx.shop.keys, {
  order_id: "ord_88421",
  sku: "home_kit_26_27",
});
printState(ctx, ["purchase_count"]);
