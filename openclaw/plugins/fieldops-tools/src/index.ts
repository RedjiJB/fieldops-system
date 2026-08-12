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
  description:
    "Tools for the FieldOps inventory and dispatch backend: assets & consumables, loadouts & checkout, orders & transfers, vendors & purchase orders, scheduling & check-in, alerts, vehicles & location, and documents.",
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

    // --- Loadouts & Checkout ---

    tool({
      name: "list_loadouts",
      label: "List Loadouts",
      description: "List loadout (kit) templates, optionally filtered by job_type_id.",
      parameters: Type.Object({
        job_type_id: Type.Optional(Type.String()),
      }),
      async execute({ job_type_id }, config) {
        const qs = job_type_id ? `?job_type_id=${job_type_id}` : "";
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/loadouts${qs}`);
      },
    }),

    tool({
      name: "create_loadout",
      label: "Create Loadout",
      description:
        "Create a new loadout (kit) template with its items. Use this the first time a job type appears with no existing template, capturing the item list a crew lead gives you so it becomes reusable next time.",
      parameters: Type.Object({
        name: Type.String(),
        job_type_id: Type.Optional(Type.String()),
        items: Type.Array(
          Type.Object({
            asset_id: Type.Optional(Type.String({ description: "Exactly one of asset_id/consumable_id required." })),
            consumable_id: Type.Optional(Type.String()),
            quantity: Type.Number({ description: "Positive quantity." }),
            scales_with_crew: Type.Optional(
              Type.Boolean({ description: "True if this quantity should multiply by crew size when resolved." }),
            ),
          }),
        ),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/loadouts", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "resolve_loadout",
      label: "Resolve Loadout",
      description:
        "Resolve a loadout template into an actual item list for a specific crew size — items marked scales_with_crew get multiplied by crew_size, others stay fixed. Use this before a crew departs to know exactly what to load.",
      parameters: Type.Object({
        id: Type.String({ description: "The loadout's UUID." }),
        crew_size: Type.Integer({ description: "Number of crew members on this job." }),
      }),
      async execute({ id, crew_size }, config) {
        return callBackend(
          config.backendUrl ?? DEFAULT_BACKEND_URL,
          `/loadouts/${id}/resolve?crew_size=${crew_size}`,
        );
      },
    }),

    tool({
      name: "checkout_asset",
      label: "Check Out Asset",
      description:
        "Check out an asset to a crew member, optionally against an order. Only works on assets with status 'available' — an unconfirmed, missing, checked_out, or retired asset will be rejected. Always confirm with the crew member before calling this, per the confirm-before-execute rule — it moves real equipment.",
      parameters: Type.Object({
        asset_id: Type.String(),
        checked_out_by: Type.String({ description: "The crew member UUID checking it out." }),
        order_id: Type.Optional(Type.String()),
        expected_return_at: Type.Optional(Type.String({ description: "ISO datetime the asset is expected back." })),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/checkouts", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "return_checkout",
      label: "Return Checkout",
      description:
        "Check an asset back in. If damage_flag is true, the asset goes to 'in_maintenance' instead of straight back to 'available' — always ask about damage before calling this if it wasn't already mentioned.",
      parameters: Type.Object({
        id: Type.String({ description: "The checkout's UUID (not the asset's)." }),
        damage_flag: Type.Optional(Type.Boolean()),
        damage_note: Type.Optional(Type.String()),
        photo_url: Type.Optional(Type.String()),
      }),
      async execute({ id, ...body }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/checkouts/${id}/return`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      },
    }),

    tool({
      name: "list_overdue_checkouts",
      label: "List Overdue Checkouts",
      description: "List all checkouts past their expected_return_at that haven't been checked back in yet.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/checkouts/overdue");
      },
    }),

    // --- Orders & Transfers ---

    tool({
      name: "create_order",
      label: "Create Order",
      description:
        "Create a material/equipment order with its items (site, date needed, spec notes). This does NOT contact a vendor — it's the first step; compile_purchase_order and send_purchase_order come after.",
      parameters: Type.Object({
        requester_id: Type.String({ description: "The crew member UUID making the request." }),
        site_id: Type.Optional(Type.String()),
        date_needed: Type.Optional(Type.String({ description: "ISO date." })),
        spec_notes: Type.Optional(Type.String({ description: "Free text for brand/color/dimension specs." })),
        items: Type.Array(
          Type.Object({
            asset_id: Type.Optional(Type.String()),
            consumable_id: Type.Optional(Type.String()),
            quantity: Type.Number(),
          }),
        ),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/orders", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "list_orders",
      label: "List Orders",
      description:
        "List orders, optionally filtered by status (requested, confirmed, picked, loaded, in_field, returned) or site_id.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union(
            ["requested", "confirmed", "picked", "loaded", "in_field", "returned"].map((s) => Type.Literal(s)),
          ),
        ),
        site_id: Type.Optional(Type.String()),
      }),
      async execute({ status, site_id }, config) {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (site_id) params.set("site_id", site_id);
        const qs = params.toString();
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/orders${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "update_order_status",
      label: "Update Order Status",
      description:
        "Advance an order's status forward: requested -> confirmed -> picked -> loaded -> in_field -> returned. Only forward moves are allowed — trying to go backward or stay the same is rejected.",
      parameters: Type.Object({
        id: Type.String(),
        status: Type.Union(
          ["requested", "confirmed", "picked", "loaded", "in_field", "returned"].map((s) => Type.Literal(s)),
        ),
      }),
      async execute({ id, status }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/orders/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
      },
    }),

    tool({
      name: "compile_purchase_order",
      label: "Compile Purchase Order",
      description:
        "Compile an order's items into a purchase order draft for a vendor. This does NOT contact the vendor directly — per policy, orders route to a human (info@ address or a specific picker) via send_purchase_order. sent_to is who that info goes to.",
      parameters: Type.Object({
        id: Type.String({ description: "The order's UUID." }),
        vendor_id: Type.String(),
        sent_to: Type.String({ description: "e.g. info@thesodboys.ca, or a specific picker's contact." }),
        eta: Type.Optional(Type.String({ description: "ISO date." })),
        cost: Type.Optional(Type.Number()),
      }),
      async execute({ id, ...body }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/orders/${id}/compile-po`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
    }),

    tool({
      name: "request_transfer",
      label: "Request Transfer",
      description:
        "Request a direct site-to-site equipment transfer (without passing back through a depot). Rejected if the asset isn't actually recorded at from_site_id — check get_asset first if unsure.",
      parameters: Type.Object({
        asset_id: Type.String(),
        from_site_id: Type.String(),
        to_site_id: Type.String(),
        requested_by: Type.String({ description: "The crew member UUID requesting it." }),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/transfers", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "update_transfer_status",
      label: "Update Transfer Status",
      description:
        "Advance a transfer's status forward: requested -> in_transit -> completed. Completing a transfer is what actually updates the asset's recorded site location.",
      parameters: Type.Object({
        id: Type.String(),
        status: Type.Union(["requested", "in_transit", "completed"].map((s) => Type.Literal(s))),
      }),
      async execute({ id, status }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/transfers/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
      },
    }),

    // --- Vendors & Purchase Orders ---

    tool({
      name: "list_vendors",
      label: "List Vendors",
      description: "List vendors with their contact method and account info.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/vendors");
      },
    }),

    tool({
      name: "add_vendor",
      label: "Add Vendor",
      description: "Add a new vendor.",
      parameters: Type.Object({
        name: Type.String(),
        contact_method: Type.Optional(Type.String({ description: "e.g. email, phone." })),
        contact_address: Type.Optional(Type.String()),
        account_number: Type.Optional(Type.String()),
        lead_time_days: Type.Optional(Type.Integer()),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/vendors", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "send_purchase_order",
      label: "Send Purchase Order",
      description:
        "Send a compiled purchase order's info to the office/picker contact (sent_to). Only works while the PO is still 'compiled' — rejected if it's already been sent.",
      parameters: Type.Object({
        id: Type.String({ description: "The purchase order's UUID." }),
        sent_to: Type.String(),
      }),
      async execute({ id, sent_to }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/purchase-orders/${id}/send`, {
          method: "POST",
          body: JSON.stringify({ sent_to }),
        });
      },
    }),

    tool({
      name: "mark_purchase_order_fulfilled",
      label: "Mark Purchase Order Fulfilled",
      description:
        "Mark a purchase order as fulfilled once the materials/equipment have actually arrived. Only works once it's been sent — rejected if it's still just 'compiled'.",
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute({ id }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/purchase-orders/${id}/fulfilled`, {
          method: "PATCH",
        });
      },
    }),

    // --- Scheduling & Check-in ---

    tool({
      name: "assign_shift",
      label: "Assign Shift",
      description: "Assign a crew member to a shift at a site on a date.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        site_id: Type.String(),
        date: Type.String({ description: "ISO date." }),
        start_time: Type.Optional(Type.String({ description: "e.g. 07:00." })),
        end_time: Type.Optional(Type.String()),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/shifts", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "confirm_shift",
      label: "Confirm Or Decline Shift",
      description:
        "Record a crew member's confirm/decline decision on an assigned shift. Only works while the shift is still 'assigned' — rejected once it's already been resolved.",
      parameters: Type.Object({
        id: Type.String({ description: "The shift's UUID." }),
        decision: Type.Union([Type.Literal("confirm"), Type.Literal("decline")]),
      }),
      async execute({ id, decision }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/shifts/${id}/confirm`, {
          method: "PATCH",
          body: JSON.stringify({ decision }),
        });
      },
    }),

    tool({
      name: "list_shifts",
      label: "List Shifts",
      description: "List shifts, optionally filtered by date and/or site_id.",
      parameters: Type.Object({
        date: Type.Optional(Type.String({ description: "ISO date." })),
        site_id: Type.Optional(Type.String()),
      }),
      async execute({ date, site_id }, config) {
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (site_id) params.set("site_id", site_id);
        const qs = params.toString();
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/shifts${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "log_timeclock_event",
      label: "Log Timeclock Event",
      description:
        "Log a check-in/break/check-out event for a crew member. Events must follow a legal sequence per crew member — 'in' first, then break_start/break_end can alternate, then 'out'. An out-of-sequence event (e.g. break_start without ever clocking in) is rejected with a clear reason.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        event_type: Type.Union(["in", "break_start", "break_end", "out"].map((s) => Type.Literal(s))),
        site_id: Type.Optional(Type.String()),
        geofence_verified: Type.Optional(
          Type.Boolean({ description: "Whether the crew member's location matched the assigned site's geofence." }),
        ),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/timeclock", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "get_crew_status",
      label: "Get Crew Status",
      description:
        "Get the live status of every active crew member — their last timeclock event, site, and timestamp. Use this to answer 'who's where right now' or 'is anyone still checked in'.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/crew/status");
      },
    }),

    // --- Alerts ---

    tool({
      name: "list_alerts",
      label: "List Alerts",
      description:
        "List exception alerts (idle, order_stalled, overdue, wrong_site), optionally filtered by resolved status. Use resolved=false to see what still needs attention.",
      parameters: Type.Object({
        resolved: Type.Optional(Type.Boolean()),
      }),
      async execute({ resolved }, config) {
        const qs = resolved !== undefined ? `?resolved=${resolved}` : "";
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/alerts${qs}`);
      },
    }),

    tool({
      name: "resolve_alert",
      label: "Resolve Alert",
      description: "Mark an alert as resolved. Rejected if it's already resolved.",
      parameters: Type.Object({
        id: Type.String(),
        resolved_by: Type.String({ description: "The crew member UUID resolving it." }),
      }),
      async execute({ id, resolved_by }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/alerts/${id}/resolve`, {
          method: "PATCH",
          body: JSON.stringify({ resolved_by }),
        });
      },
    }),

    // --- Vehicles & Location ---

    tool({
      name: "log_vehicle_location",
      label: "Log Vehicle Location",
      description:
        "Log a WhatsApp shared-location point against a vehicle. This is the sole real-time position source for now — no OBD hardware yet.",
      parameters: Type.Object({
        id: Type.String({ description: "The vehicle's UUID." }),
        lat: Type.Number(),
        lng: Type.Number(),
        source: Type.Optional(Type.Union([Type.Literal("whatsapp_location"), Type.Literal("obd")])),
      }),
      async execute({ id, ...body }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/vehicles/${id}/telemetry`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
    }),

    tool({
      name: "start_trip",
      label: "Start Trip",
      description:
        "Start and label a trip for a vehicle (e.g. 'dump run', 'sod pickup'). Rejected if that vehicle already has an open trip — end it first.",
      parameters: Type.Object({
        vehicle_id: Type.String(),
        driver_id: Type.String(),
        purpose_tag: Type.Optional(Type.String({ description: "Free-text label, e.g. 'dump run'." })),
        site_id: Type.Optional(Type.String()),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/trips", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "end_trip",
      label: "End Trip",
      description: "Close out a trip. Rejected if it's already ended.",
      parameters: Type.Object({
        id: Type.String({ description: "The trip's UUID." }),
      }),
      async execute({ id }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/trips/${id}/end`, {
          method: "PATCH",
        });
      },
    }),

    tool({
      name: "list_vehicle_trips",
      label: "List Vehicle Trips",
      description: "List trip history for a vehicle, most recent first.",
      parameters: Type.Object({
        id: Type.String({ description: "The vehicle's UUID." }),
      }),
      async execute({ id }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/vehicles/${id}/trips`);
      },
    }),

    // --- Documents ---

    tool({
      name: "log_document",
      label: "Log Document",
      description:
        "Log a document (contract, permit, photo, receipt, disposal_ticket, or insurance_cert) with site tagging. Set expiry_date for anything that expires (permits, insurance certs) so it surfaces in list_expiring_documents.",
      parameters: Type.Object({
        type: Type.Union(
          ["contract", "permit", "photo", "receipt", "disposal_ticket", "insurance_cert"].map((s) => Type.Literal(s)),
        ),
        filename: Type.String(),
        uploaded_by: Type.String({ description: "The crew member UUID uploading it." }),
        site_id: Type.Optional(Type.String()),
        job_id: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Array(Type.String())),
        expiry_date: Type.Optional(Type.String({ description: "ISO date." })),
      }),
      async execute(input, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, "/documents", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "list_documents",
      label: "List Documents",
      description:
        "List documents, optionally filtered by site_id and/or type. Use this for 'everything for Site 7' style requests.",
      parameters: Type.Object({
        site_id: Type.Optional(Type.String()),
        type: Type.Optional(
          Type.Union(
            ["contract", "permit", "photo", "receipt", "disposal_ticket", "insurance_cert"].map((s) => Type.Literal(s)),
          ),
        ),
      }),
      async execute({ site_id, type }, config) {
        const params = new URLSearchParams();
        if (site_id) params.set("site_id", site_id);
        if (type) params.set("type", type);
        const qs = params.toString();
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/documents${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "list_expiring_documents",
      label: "List Expiring Documents",
      description:
        "List documents expiring within N days (insurance/cert/permit expiry check). Includes anything already past its expiry, not just upcoming ones — an expired cert is more urgent than one expiring next week.",
      parameters: Type.Object({
        within_days: Type.Integer({ description: "Look-ahead window in days." }),
      }),
      async execute({ within_days }, config) {
        return callBackend(config.backendUrl ?? DEFAULT_BACKEND_URL, `/documents/expiring?within_days=${within_days}`);
      },
    }),
  ],
});
