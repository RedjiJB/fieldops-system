import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const configSchema = Type.Object({
  backendUrl: Type.Optional(
    Type.String({ description: "FieldOps backend API base URL, e.g. http://localhost:3000/api/v1" }),
  ),
  serviceToken: Type.Optional(
    Type.String({
      description:
        "Bearer token authenticating this plugin against the backend's AGENT_SERVICE_TOKEN — required once the backend has dashboard auth enabled.",
    }),
  ),
});

const DEFAULT_BACKEND_URL = "http://localhost:3000/api/v1";

type PluginConfig = { backendUrl?: string; serviceToken?: string };

async function callBackend(
  config: PluginConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const backendUrl = config.backendUrl ?? DEFAULT_BACKEND_URL;
  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(config.serviceToken ? { Authorization: `Bearer ${config.serviceToken}` } : {}),
      ...init?.headers,
    },
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
    "Tools for the FieldOps inventory and dispatch backend: assets & consumables, loadouts & checkout, orders & transfers, vendors & purchase orders, crew members, scheduling & check-in, alerts, vehicles & location, and documents.",
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
        return callBackend(config, `/assets${qs ? `?${qs}` : ""}`);
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
        return callBackend(config, `/assets/${id}`);
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
        return callBackend(config, "/assets", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "verify_asset",
      label: "Verify Asset",
      description:
        "Confirm an asset physically exists (a bootstrap-sweep or spot-check confirmation). This is the ONLY way an asset becomes 'available' for assignment. Two-party confirm-before-execute pilot: this now requires management's confirmation before it takes effect — tell the crew member it's been sent for approval, they'll be told the outcome automatically.",
      parameters: Type.Object({
        id: Type.String({ description: "The asset's UUID." }),
        verified_by: Type.String({ description: "The crew member UUID doing the verification." }),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, e.g. \"Redji verifying the trencher exists and is in good condition\".",
        }),
      }),
      async execute({ id, verified_by, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "asset_verification",
            summary,
            crew_member_id: verified_by,
            payload: { asset_id: id },
          }),
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
        return callBackend(config, `/assets/${id}/status`, {
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
        return callBackend(config, `/consumables${qs}`);
      },
    }),

    tool({
      name: "adjust_consumable_quantity",
      label: "Adjust Consumable Quantity",
      description:
        "Request an adjustment to a 'stocked' consumable's on-hand quantity by a delta — positive for a restock, negative for reported usage. Two-party confirm-before-execute pilot: this now requires management's confirmation before it takes effect — tell the crew member it's been sent for approval, they'll be told the outcome automatically, they don't need to check back. Only works on 'stocked' items; re-checked at approval time.",
      parameters: Type.Object({
        id: Type.String({ description: "The consumable's UUID." }),
        delta: Type.Number({ description: "Positive to add (restock), negative to subtract (usage)." }),
        crew_member_id: Type.String({ description: "The crew member reporting this." }),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, reusing the wording already confirmed with the crew member, e.g. \"Redji used 3 bags of mulch at Site 7\".",
        }),
      }),
      async execute({ id, delta, crew_member_id, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "consumable_adjustment",
            summary,
            crew_member_id,
            payload: { consumable_id: id, delta },
          }),
        });
      },
    }),

    tool({
      name: "list_sites",
      label: "List Sites",
      description:
        "List/filter sites (job_site, depot, vendor, or shop). Use this to resolve a site name someone mentions (e.g. 'Site 7', 'Access Storage') to a site_id before acting.",
      parameters: Type.Object({
        type: Type.Optional(
          Type.Union(["job_site", "depot", "vendor", "shop"].map((t) => Type.Literal(t))),
        ),
      }),
      async execute({ type }, config) {
        const qs = type ? `?type=${type}` : "";
        return callBackend(config, `/sites${qs}`);
      },
    }),

    tool({
      name: "get_site",
      label: "Get Site Detail",
      description: "Get full detail for one site by id.",
      parameters: Type.Object({
        id: Type.String({ description: "The site's UUID." }),
      }),
      async execute({ id }, config) {
        return callBackend(config, `/sites/${id}`);
      },
    }),

    tool({
      name: "register_site",
      label: "Register Site",
      description: "Register a new site — a job site, depot, vendor location, or shop.",
      parameters: Type.Object({
        name: Type.String(),
        type: Type.Union(["job_site", "depot", "vendor", "shop"].map((t) => Type.Literal(t))),
        address: Type.Optional(Type.String()),
        access_instructions: Type.Optional(Type.String()),
        access_hours: Type.Optional(Type.String()),
        center_lat: Type.Optional(Type.Number()),
        center_lng: Type.Optional(Type.Number()),
        geofence_radius_m: Type.Optional(Type.Integer()),
      }),
      async execute(input, config) {
        return callBackend(config, "/sites", {
          method: "POST",
          body: JSON.stringify(input),
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
        return callBackend(config, `/sites/${site_id}/inventory`);
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
        return callBackend(config, `/loadouts${qs}`);
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
        return callBackend(config, "/loadouts", {
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
        return callBackend(config, `/loadouts/${id}/resolve?crew_size=${crew_size}`);
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
        return callBackend(config, "/checkouts", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "return_checkout",
      label: "Return Checkout",
      description:
        "Request checking an asset back in. Two-party confirm-before-execute pilot: this now requires management's confirmation before it takes effect — tell the crew member it's been sent for approval, they'll be told the outcome automatically. If damage_flag is true, the asset moves to 'in_maintenance' instead of 'available' once approved — always ask about damage before calling this if it wasn't already mentioned.",
      parameters: Type.Object({
        id: Type.String({ description: "The checkout's UUID (not the asset's)." }),
        returned_by: Type.String({ description: "The crew member UUID returning it." }),
        damage_flag: Type.Optional(Type.Boolean()),
        damage_note: Type.Optional(Type.String()),
        photo_url: Type.Optional(Type.String()),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, reusing the wording already confirmed with the crew member, e.g. \"Redji returning the trencher, no damage\".",
        }),
      }),
      async execute({ id, returned_by, damage_flag, damage_note, photo_url, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "checkout_return",
            summary,
            crew_member_id: returned_by,
            payload: { checkout_id: id, damage_flag, damage_note, photo_url },
          }),
        });
      },
    }),

    tool({
      name: "list_overdue_checkouts",
      label: "List Overdue Checkouts",
      description: "List all checkouts past their expected_return_at that haven't been checked back in yet.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return callBackend(config, "/checkouts/overdue");
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
        return callBackend(config, "/orders", {
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
        return callBackend(config, `/orders${qs ? `?${qs}` : ""}`);
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
        return callBackend(config, `/orders/${id}/status`, {
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
        return callBackend(config, `/orders/${id}/compile-po`, {
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
        return callBackend(config, "/transfers", {
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
        return callBackend(config, `/transfers/${id}/status`, {
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
        return callBackend(config, "/vendors");
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
        return callBackend(config, "/vendors", {
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
        return callBackend(config, `/purchase-orders/${id}/send`, {
          method: "POST",
          body: JSON.stringify({ sent_to }),
        });
      },
    }),

    tool({
      name: "mark_purchase_order_fulfilled",
      label: "Mark Purchase Order Fulfilled",
      description:
        "Mark a purchase order as fulfilled once the materials/equipment have actually arrived. Only works once it's been sent — rejected if it's still just 'compiled'. Two-party confirm-before-execute pilot: this now requires management's confirmation before it takes effect — tell the crew member it's been sent for approval, they'll be told the outcome automatically.",
      parameters: Type.Object({
        id: Type.String(),
        confirmed_by: Type.String({ description: "The crew member UUID confirming the delivery arrived." }),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, e.g. \"Redji confirming the mulch delivery from GreenSupply arrived\".",
        }),
      }),
      async execute({ id, confirmed_by, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "purchase_order_fulfillment",
            summary,
            crew_member_id: confirmed_by,
            payload: { purchase_order_id: id },
          }),
        });
      },
    }),

    // --- Crew Members ---
    // Added after testing surfaced a real gap: nothing could resolve a
    // WhatsApp sender's phone number to a crew_member_id, even though
    // crew_members.phone is explicitly commented "WhatsApp identity" in the
    // schema. See AGENTS.md's "Resolving who's messaging you" section —
    // use list_crew_members with the phone filter for that, always, before
    // answering any "my/me" style question.

    tool({
      name: "list_crew_members",
      label: "List Crew Members",
      description:
        "List/filter crew members. Use the phone filter to resolve a WhatsApp sender's phone number to a crew_member_id — do this before answering any question about 'my' shift, checkouts, or status.",
      parameters: Type.Object({
        phone: Type.Optional(Type.String({ description: "E.164 phone number, e.g. +15555550123." })),
        role: Type.Optional(
          Type.Union(["crew", "crew_lead", "yard", "management"].map((r) => Type.Literal(r))),
        ),
        active: Type.Optional(Type.Boolean()),
      }),
      async execute({ phone, role, active }, config) {
        const params = new URLSearchParams();
        if (phone) params.set("phone", phone);
        if (role) params.set("role", role);
        if (active !== undefined) params.set("active", String(active));
        const qs = params.toString();
        return callBackend(config, `/crew-members${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "register_crew_member",
      label: "Register Crew Member",
      description: "Register a new crew member (new hire). Defaults to role 'crew' if not specified.",
      parameters: Type.Object({
        name: Type.String(),
        phone: Type.String({ description: "E.164 phone number, e.g. +15555550123." }),
        role: Type.Optional(
          Type.Union(["crew", "crew_lead", "yard", "management"].map((r) => Type.Literal(r))),
        ),
      }),
      async execute(input, config) {
        return callBackend(config, "/crew-members", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    // --- Scheduling & Check-in ---

    tool({
      name: "list_job_types",
      label: "List Job Types",
      description:
        "List known job types (e.g. interlock_repair, sod_install, service_call). Use this to resolve a freeform job description from a dispatch message to an id before calling create_job — never guess an id.",
      parameters: Type.Object({}),
      async execute(_input, config) {
        return callBackend(config, "/job-types");
      },
    }),

    tool({
      name: "create_job",
      label: "Create Job",
      description:
        "Create a job (site + date + job type) that one or more shifts can be linked to via assign_shift/assign_shifts_batch's job_id. Only create one when a dispatch message actually names or clearly implies a job type — if it doesn't, skip this and assign shifts without a job_id exactly as before. Part of the same confirmation as the shift assignment, not a separate ask.",
      parameters: Type.Object({
        site_id: Type.String(),
        job_type_id: Type.Optional(Type.String({ description: "From list_job_types — omit if not resolvable." })),
        date: Type.String({ description: "ISO date." }),
      }),
      async execute(input, config) {
        return callBackend(config, "/jobs", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "list_jobs",
      label: "List Jobs",
      description: "List jobs, optionally filtered by date, site, or status.",
      parameters: Type.Object({
        date: Type.Optional(Type.String({ description: "ISO date." })),
        site_id: Type.Optional(Type.String()),
        status: Type.Optional(
          Type.Union(["not_started", "in_progress", "complete"].map((s) => Type.Literal(s))),
        ),
      }),
      async execute({ date, site_id, status }, config) {
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (site_id) params.set("site_id", site_id);
        if (status) params.set("status", status);
        const qs = params.toString();
        return callBackend(config, `/jobs${qs ? `?${qs}` : ""}`);
      },
    }),

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
        job_id: Type.Optional(
          Type.String({ description: "Link this shift to a job (see create_job) if the dispatch names a job type." }),
        ),
      }),
      async execute(input, config) {
        return callBackend(config, "/shifts", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "assign_shifts_batch",
      label: "Assign Multiple Shifts",
      description:
        "Assign several shifts at once, all-or-nothing — use this instead of calling assign_shift repeatedly when one dispatch message covers multiple people/sites (e.g. 'Team 1: Jesse + Doug at Site A 800hh, Team 2: Korbin at Site B 730hh'). If any single assignment is invalid, none are created — no partial dispatch.",
      parameters: Type.Object({
        shifts: Type.Array(
          Type.Object({
            crew_member_id: Type.String(),
            site_id: Type.String(),
            date: Type.String({ description: "ISO date." }),
            start_time: Type.Optional(Type.String({ description: "e.g. 07:00." })),
            end_time: Type.Optional(Type.String()),
            job_id: Type.Optional(
              Type.String({ description: "Link this shift to a job (see create_job) if the dispatch names a job type." }),
            ),
          }),
        ),
      }),
      async execute(input, config) {
        return callBackend(config, "/shifts/batch", {
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
        return callBackend(config, `/shifts/${id}/confirm`, {
          method: "PATCH",
          body: JSON.stringify({ decision }),
        });
      },
    }),

    tool({
      name: "list_shifts",
      label: "List Shifts",
      description:
        "List shifts, optionally filtered by date, site_id, and/or crew_member_id. For 'what's my shift' questions, resolve the sender to a crew_member_id first (list_crew_members), then filter by it here.",
      parameters: Type.Object({
        date: Type.Optional(Type.String({ description: "ISO date." })),
        site_id: Type.Optional(Type.String()),
        crew_member_id: Type.Optional(Type.String()),
      }),
      async execute({ date, site_id, crew_member_id }, config) {
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (site_id) params.set("site_id", site_id);
        if (crew_member_id) params.set("crew_member_id", crew_member_id);
        const qs = params.toString();
        return callBackend(config, `/shifts${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "log_timeclock_event",
      label: "Log Timeclock Event",
      description:
        "Request logging a check-in/break/check-out event for a crew member. Two-party confirm-before-execute pilot: this now requires management's confirmation before it's recorded — tell the crew member it's been sent for approval, they'll be told the outcome automatically, they don't need to check back. Events must still follow a legal sequence per crew member — 'in' first, then break_start/break_end can alternate, then 'out' — that's re-checked at approval time, since it may have changed while this sat pending.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        event_type: Type.Union(["in", "break_start", "break_end", "out"].map((s) => Type.Literal(s))),
        site_id: Type.Optional(Type.String()),
        geofence_verified: Type.Optional(
          Type.Boolean({ description: "Whether the crew member's location matched the assigned site's geofence." }),
        ),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, reusing the wording already confirmed with the crew member, e.g. \"Redji clocking in at Site 7\".",
        }),
      }),
      async execute({ crew_member_id, event_type, site_id, geofence_verified, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "timeclock_event",
            summary,
            crew_member_id,
            payload: { event_type, site_id, geofence_verified },
          }),
        });
      },
    }),

    tool({
      name: "submit_mileage_claim",
      label: "Submit Mileage Claim",
      description:
        "Submit a personal-vehicle mileage reimbursement claim for a crew member. Two-party confirm-before-execute: management reviews it and sets the reimbursement rate at the moment of approval, not a fixed system-wide number — the crew member is told the outcome automatically once decided, they don't need to check back.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        distance_km: Type.Number({ description: "Distance driven, in km." }),
        description: Type.Optional(Type.String({ description: "What the trip was for." })),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, e.g. \"Redji claiming 40km for a supply run to Site 7\".",
        }),
      }),
      async execute({ crew_member_id, distance_km, description, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "mileage_claim",
            summary,
            crew_member_id,
            payload: { distance_km, description },
          }),
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
        return callBackend(config, "/crew/status");
      },
    }),

    // --- Alerts ---

    tool({
      name: "list_alerts",
      label: "List Alerts",
      description:
        "List exception alerts (idle, order_stalled, overdue, wrong_site, vehicle_dark, delay, weather), optionally filtered by resolved status. Use resolved=false to see what still needs attention.",
      parameters: Type.Object({
        resolved: Type.Optional(Type.Boolean()),
      }),
      async execute({ resolved }, config) {
        const qs = resolved !== undefined ? `?resolved=${resolved}` : "";
        return callBackend(config, `/alerts${qs}`);
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
        return callBackend(config, `/alerts/${id}/resolve`, {
          method: "PATCH",
          body: JSON.stringify({ resolved_by }),
        });
      },
    }),

    // --- Vehicles & Location ---

    tool({
      name: "list_vehicles",
      label: "List Vehicles",
      description:
        "List/filter vehicles. Use assigned_crew_id to find which vehicle a crew member drives — this is how you resolve a WhatsApp location share to a vehicle before calling log_vehicle_location.",
      parameters: Type.Object({
        assigned_crew_id: Type.Optional(Type.String()),
        plate: Type.Optional(Type.String()),
      }),
      async execute(input, config) {
        const qs = new URLSearchParams(input as Record<string, string>).toString();
        return callBackend(config, `/vehicles${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "get_vehicle",
      label: "Get Vehicle",
      description:
        "Vehicle detail, including its latest logged location if any — latest_location.address is a real street address, prefer it over the raw lat/lng.",
      parameters: Type.Object({
        id: Type.String(),
      }),
      async execute({ id }, config) {
        return callBackend(config, `/vehicles/${id}`);
      },
    }),

    tool({
      name: "register_vehicle",
      label: "Register Vehicle",
      description: "Register a new vehicle (plate, optionally an assigned crew member and current mileage).",
      parameters: Type.Object({
        plate: Type.String(),
        assigned_crew_id: Type.Optional(Type.String()),
        current_mileage: Type.Optional(Type.Number()),
      }),
      async execute(input, config) {
        return callBackend(config, "/vehicles", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
    }),

    tool({
      name: "log_vehicle_location",
      label: "Log Vehicle Location",
      description:
        "Log a WhatsApp shared-location point against a vehicle. This is the sole real-time position source for now — no OBD hardware yet. The response includes a reverse-geocoded `address` (a real street address, e.g. '45 O'Connor Street, Ottawa') — use that in replies, not the raw lat/lng.",
      parameters: Type.Object({
        id: Type.String({ description: "The vehicle's UUID." }),
        lat: Type.Number(),
        lng: Type.Number(),
        source: Type.Optional(Type.Union([Type.Literal("whatsapp_location"), Type.Literal("obd")])),
      }),
      async execute({ id, ...body }, config) {
        return callBackend(config, `/vehicles/${id}/telemetry`, {
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
        return callBackend(config, "/trips", {
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
        return callBackend(config, `/trips/${id}/end`, {
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
        return callBackend(config, `/vehicles/${id}/trips`);
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
        return callBackend(config, "/documents", {
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
        return callBackend(config, `/documents${qs ? `?${qs}` : ""}`);
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
        return callBackend(config, `/documents/expiring?within_days=${within_days}`);
      },
    }),

    tool({
      name: "list_missing_receipts",
      label: "List Missing Receipts",
      description:
        "List approved spend records with no linked receipt document — for a year-end/tax-prep check of 'are we missing a receipt for X'. Mileage claims are excluded (rate-computed, not receipt-based, so they structurally can't have one). Separate from list_expiring_documents, which is about documents that exist and are about to lapse, not spend with no document at all.",
      parameters: Type.Object({
        category: Type.Optional(
          Type.Union(["material", "fuel", "receipt", "other"].map((s) => Type.Literal(s))),
        ),
        date_from: Type.Optional(Type.String({ description: "ISO date." })),
        date_to: Type.Optional(Type.String({ description: "ISO date." })),
      }),
      async execute({ category, date_from, date_to }, config) {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        if (date_from) params.set("date_from", date_from);
        if (date_to) params.set("date_to", date_to);
        const qs = params.toString();
        return callBackend(config, `/spend-records/missing-receipts${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "list_notifications",
      label: "List Notifications",
      description:
        "List notification events for a time window. By default (no priority given) returns routine (non-urgent) events for digest/status-check summaries — new tools registered, verifications, maintenance, order status moves, idle-crew flags, vehicle-dark flags. Critical events (missing tools, wrong-site, overdue, stalled orders) are already pushed to management directly the moment they happen, so don't repeat them in a digest unless priority='critical' is explicitly requested — e.g. when resolving which open critical notification an acknowledgment reply refers to (set unacknowledged_only=true for that; see AGENTS.md's 'Acknowledging critical notifications'). whatsapp_message_id matches a specific notification by the WhatsApp message id this system sent it under, if the inbound message was a quoted reply to it.",
      parameters: Type.Object({
        since: Type.Optional(
          Type.String({ description: "ISO 8601 timestamp; defaults to the last 24 hours." }),
        ),
        priority: Type.Optional(Type.Union([Type.Literal("critical"), Type.Literal("routine")])),
        unacknowledged_only: Type.Optional(Type.Boolean()),
        whatsapp_message_id: Type.Optional(
          Type.String({ description: "The quoted message's id, if the inbound message was a WhatsApp reply." }),
        ),
      }),
      async execute({ since, priority, unacknowledged_only, whatsapp_message_id }, config) {
        const params = new URLSearchParams();
        params.set("priority", priority ?? "routine");
        params.set("since", since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        if (unacknowledged_only) params.set("acknowledged", "false");
        if (whatsapp_message_id) params.set("whatsapp_message_id", whatsapp_message_id);
        return callBackend(config, `/notifications?${params.toString()}`);
      },
    }),

    tool({
      name: "acknowledge_notification",
      label: "Acknowledge Notification",
      description:
        "Mark a critical notification as seen/handled — distinct from resolve_alert, which means the underlying issue is actually fixed. Acknowledging does NOT resolve the alert; never call resolve_alert as a side effect of this. See AGENTS.md's 'Acknowledging critical notifications' for when to call this. Rejected if already acknowledged.",
      parameters: Type.Object({
        id: Type.String(),
        acknowledged_by: Type.String({ description: "The crew member UUID acknowledging it." }),
      }),
      async execute({ id, acknowledged_by }, config) {
        return callBackend(config, `/notifications/${id}/acknowledge`, {
          method: "PATCH",
          body: JSON.stringify({ acknowledged_by }),
        });
      },
    }),

    tool({
      name: "list_pending_confirmations",
      label: "List Pending Confirmations",
      description:
        "List two-party confirm-before-execute requests (hours, material-usage claims, checkout damage/condition claims, mileage claims) awaiting management review. whatsapp_message_id matches one by the WhatsApp message id its paging notification was sent under, if the inbound message was a quoted reply to it — see AGENTS.md's 'Approving pending confirmations over WhatsApp' for the full resolution order (id-match first, then status=awaiting_management and act only if exactly one is open).",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union(["awaiting_management", "approved", "rejected", "expired"].map((s) => Type.Literal(s))),
        ),
        whatsapp_message_id: Type.Optional(
          Type.String({ description: "The quoted message's id, if the inbound message was a WhatsApp reply." }),
        ),
      }),
      async execute({ status, whatsapp_message_id }, config) {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (whatsapp_message_id) params.set("whatsapp_message_id", whatsapp_message_id);
        const qs = params.toString();
        return callBackend(config, `/pending-confirmations${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "approve_pending_confirmation",
      label: "Approve Pending Confirmation",
      description:
        "Approve a pending confirmation on management's behalf. Only a crew member with role 'management' can call this (the backend enforces it — 403 otherwise), so resolve and verify the sender's role first per AGENTS.md. rate_per_km is required if (and only if) the confirmation's action_type is 'mileage_claim' — its amount is computed from this rate at the moment of approval, not a fixed number; ask for it before calling this if it wasn't given. 400 if already reviewed.",
      parameters: Type.Object({
        id: Type.String(),
        reviewed_by: Type.String({ description: "The management crew member's UUID approving it." }),
        rate_per_km: Type.Optional(Type.Number({ description: "Required only for a mileage_claim." })),
      }),
      async execute({ id, reviewed_by, rate_per_km }, config) {
        return callBackend(config, `/pending-confirmations/${id}/approve`, {
          method: "PATCH",
          body: JSON.stringify({ reviewed_by, rate_per_km }),
        });
      },
    }),

    tool({
      name: "reject_pending_confirmation",
      label: "Reject Pending Confirmation",
      description:
        "Reject a pending confirmation on management's behalf. Only a crew member with role 'management' can call this (the backend enforces it — 403 otherwise). The crew member who originally submitted it is told automatically — nothing further to do here. 400 if already reviewed.",
      parameters: Type.Object({
        id: Type.String(),
        reviewed_by: Type.String({ description: "The management crew member's UUID rejecting it." }),
      }),
      async execute({ id, reviewed_by }, config) {
        return callBackend(config, `/pending-confirmations/${id}/reject`, {
          method: "PATCH",
          body: JSON.stringify({ reviewed_by }),
        });
      },
    }),

    tool({
      name: "report_safety_incident",
      label: "Report Safety Incident",
      description:
        "Push an instant critical alert to management for an injury, on-site accident, or immediate physical danger. See AGENTS.md's 'Safety and emergencies' — this overrides confirm-before-execute (no confirmation needed, call it immediately) and is separate from telling the sender to call 911, which you do in your own reply, not through this tool.",
      parameters: Type.Object({
        message: Type.String({ description: "Brief summary of what was reported." }),
        crew_member_id: Type.Optional(Type.String({ description: "The reporting crew member's UUID, if resolved." })),
      }),
      async execute({ message, crew_member_id }, config) {
        return callBackend(config, "/notifications/safety-report", {
          method: "POST",
          body: JSON.stringify({ message, crew_member_id }),
        });
      },
    }),
  ],
});
