import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("fieldops-tools", () => {
  it("declares tool metadata", () => {
    expect(getToolPluginMetadata(entry)?.tools.map((tool) => tool.name)).toEqual([
      "list_assets",
      "get_asset",
      "register_asset",
      "verify_asset",
      "update_asset_status",
      "list_consumables",
      "adjust_consumable_quantity",
      "get_site_inventory",
    ]);
  });
});
