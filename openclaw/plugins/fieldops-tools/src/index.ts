import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const configSchema = Type.Object({
  backendUrl: Type.Optional(
    Type.String({ description: "FieldOps backend API base URL, e.g. http://localhost:3000/api/v1" }),
  ),
});

const DEFAULT_BACKEND_URL = "http://localhost:3000/api/v1";

async function callBackend(
  backendUrl: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { error: true, status: res.status, message: (body as { error?: string })?.error ?? res.statusText };
  }
  return body;
}

const ASSET_STATUSES_SETTABLE = [
  "checked_out",
  "missing",
  "in_maintenance",
  "unconfirmed",
  "retired",
] as const;

export default defineToolPlugin({
  id: "fieldops-tools",
  name: "FieldOps Tools",
  description: "Tools for the FieldOps inventory and dispatch backend — assets and consumables.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "list_assets",
      label: "List Assets",
      description:
        "List equipment/assets, optionally filtered by status (available, checked_out, missing, in_maintenance, unconfirmed, retired), site_id, or category. Use this to find an asset's id before checking it out, verifying it, or changing its status.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union(
            ["available", "checked_out", "missing", "in_maintenance", "unconfirmed", "retired"].map((s) =>
              Type.Literal(s),
            ),
          ),
        ),
        site_id: Type.Optional(Type.String({ description: "Filter to assets currently at this site." })),
        category: Type.Optional(Type.String({ description: "Filter by category, e.g. compactor, power_tool." })),
      }),
      async execute({ status, site_id, category }, config) {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (site_id) params.set("site_id", site_id);
        if (category) params.set("category", category);
        const qs = params.toString();
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/assets${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "get_asset",
      label: "Get Asset Detail",
      description: "Get full detail for one asset by id, including its checkout history.",
      parameters: Type.Object({
        id: Type.String({ description: "The asset's UUID." }),
      }),
      async execute({ id }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/assets/${id}`);
      },
    }),

    tool({
      name: "register_asset",
      label: "Register Asset",
      description:
        "Register a brand-new asset (e.g. on purchase). New assets always start as 'unconfirmed' and won't be assignable until verify_asset is called on them — never assume it's usable right after registering.",
      parameters: Type.Object({
        name: Type.String(),
        category: Type.String(),
        qr_tag_id: Type.String({ description: "The unique QR tag identifier physically on the asset." }),
        purchase_date: Type.Optional(Type.String({ description: "ISO date, e.g. 2026-08-12." })),
        condition: Type.Optional(Type.String()),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/assets", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "verify_asset",
      label: "Verify Asset",
      description:
        "Confirm an asset physically exists (a bootstrap-sweep or spot-check confirmation). This is the ONLY way an asset becomes 'available' for assignment — sets status to available and records who verified it and when.",
      parameters: Type.Object({
        id: Type.String({ description: "The asset's UUID." }),
        verified_by: Type.String({ description: "The crew member UUID doing the verification." }),
      }),
      async execute({ id, verified_by }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/assets/${id}/verify`, {
          method: "PATCH",
          body: JSON.stringify({ verified_by }),
        });
      },
    }),

    tool({
      name: "update_asset_status",
      label: "Update Asset Status",
      description:
        "Update an asset's status to checked_out, missing, in_maintenance, unconfirmed, or retired. This does NOT accept 'available' — that only happens through verify_asset, since an asset can't become assignable without a confirmation record.",
      parameters: Type.Object({
        id: Type.String({ description: "The asset's UUID." }),
        status: Type.Union(ASSET_STATUSES_SETTABLE.map((s) => Type.Literal(s))),
      }),
      async execute({ id, status }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/assets/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
      },
    }),

    tool({
      name: "list_consumables",
      label: "List Consumables",
      description:
        "List materials/consumables, optionally filtered by stocking_type. 'stocked' items carry an on-hand quantity (bagged goods with a reorder threshold); 'per_job_delivery' items (like sod, topsoil) are ordered fresh per job and have no on-hand quantity.",
      parameters: Type.Object({
        stocking_type: Type.Optional(Type.Union([Type.Literal("stocked"), Type.Literal("per_job_delivery")])),
      }),
      async execute({ stocking_type }, config) {
        const qs = stocking_type ? `?stocking_type=${stocking_type}` : "";
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/consumables${qs}`);
      },
    }),

    tool({
      name: "adjust_consumable_quantity",
      label: "Adjust Consumable Quantity",
      description:
        "Adjust a 'stocked' consumable's on-hand quantity by a delta — positive for a restock, negative for reported usage. Only works on 'stocked' items; per_job_delivery items don't carry an on-hand quantity and will be rejected.",
      parameters: Type.Object({
        id: Type.String({ description: "The consumable's UUID." }),
        delta: Type.Number({ description: "Positive to add (restock), negative to subtract (usage)." }),
      }),
      async execute({ id, delta }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/consumables/${id}/quantity`, {
          method: "PATCH",
          body: JSON.stringify({ delta }),
        });
      },
    }),

    tool({
      name: "get_site_inventory",
      label: "Get Site Inventory",
      description:
        "Get everything currently confirmed (physically verified) at a given site — e.g. 'what's at Access Storage' or 'what's at Site 7'.",
      parameters: Type.Object({
        site_id: Type.String({ description: "The site's UUID." }),
      }),
      async execute({ site_id }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/sites/${site_id}/inventory`);
      },
    }),
  ],
});
