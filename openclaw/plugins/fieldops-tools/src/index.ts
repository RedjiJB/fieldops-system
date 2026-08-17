import { execFileSync } from "node:child_process";
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

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

    tool({
      name: "set_preferred_language",
      label: "Set Preferred Language",
      description:
        "Record which language to converse with a crew member in going forward (English or French). Call this once a crew member indicates a preference — e.g. they write to you in French, or ask you to reply in French. Resolve them to a crew_member_id first (per 'Resolving who's messaging you') if you don't already have it. Doesn't need confirmation first -- this only changes how you talk to them, it doesn't move inventory/money/schedule.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        preferred_language: Type.Union([Type.Literal("en"), Type.Literal("fr")]),
      }),
      async execute({ crew_member_id, preferred_language }, config) {
        return callBackend(config, `/crew-members/${crew_member_id}`, {
          method: "PATCH",
          body: JSON.stringify({ preferred_language }),
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
        "Request logging a check-in/break/check-out event for a crew member. Two-party confirm-before-execute pilot: this now requires management's confirmation before it's recorded — tell the crew member it's been sent for approval, they'll be told the outcome automatically, they don't need to check back. Events must still follow a legal sequence per crew member — 'in' first, then break_start/break_end can alternate, then 'out' — that's re-checked at approval time, since it may have changed while this sat pending. If a location share came in alongside or shortly before this (a 📍/🛰 coordinate line per 'Live vehicle location'), pass its lat/lng — the backend independently verifies it against the site's geofence, you never assert whether it matched yourself.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        event_type: Type.Union(["in", "break_start", "break_end", "out"].map((s) => Type.Literal(s))),
        site_id: Type.Optional(Type.String()),
        lat: Type.Optional(Type.Number({ description: "Latitude from a location share received alongside this event, if any." })),
        lng: Type.Optional(Type.Number({ description: "Longitude from a location share received alongside this event, if any." })),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, reusing the wording already confirmed with the crew member, e.g. \"Redji clocking in at Site 7\".",
        }),
      }),
      async execute({ crew_member_id, event_type, site_id, lat, lng, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "timeclock_event",
            summary,
            crew_member_id,
            payload: { event_type, site_id, lat, lng },
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

    // Two-party pilot member, not single-party -- an extension changes
    // payroll hours, same "the crew member's own statement isn't
    // independent verification" reasoning as the other five (see
    // AGENTS.md). new_end_time overwrites the shift's end_time outright on
    // approval, no "+N hours" math on the backend side.
    tool({
      name: "request_shift_extension",
      label: "Request Shift Extension",
      description:
        "Request extending a crew member's shift to a new end time (e.g. running behind on a job). Two-party confirm-before-execute: management reviews it before the shift's end_time actually changes — the crew member is told the outcome automatically once decided, they don't need to check back.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        shift_id: Type.String(),
        new_end_time: Type.String({ description: "New end time, HH:MM:SS (24h)." }),
        reason: Type.Optional(Type.String({ description: "Why the extension is needed." })),
        summary: Type.String({
          description:
            "Short plain-language summary of the request for management to review, e.g. \"Redji requesting shift extended to 18:30 at Site 7, running behind on cleanup\".",
        }),
      }),
      async execute({ crew_member_id, shift_id, new_end_time, reason, summary }, config) {
        return callBackend(config, "/pending-confirmations", {
          method: "POST",
          body: JSON.stringify({
            action_type: "shift_extension",
            summary,
            crew_member_id,
            payload: { shift_id, new_end_time, reason },
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

    // Person-level counterpart to log_vehicle_location, same "passive
    // telemetry, no confirmation needed" reasoning -- a location share is
    // something the crew member already chose to send. Log this one in
    // addition to log_vehicle_location whenever a location share comes in,
    // not instead of it -- a crew member can have both an assigned vehicle
    // and their own location stream at once.
    tool({
      name: "log_crew_location",
      label: "Log Crew Location",
      description:
        "Log a WhatsApp shared-location point (a one-time pin or a live share, e.g. an 8-hour shift-long share) against the crew member themselves, independent of any vehicle. The response includes a reverse-geocoded `address` — use that in replies, not the raw lat/lng.",
      parameters: Type.Object({
        id: Type.String({ description: "The crew member's UUID." }),
        lat: Type.Number(),
        lng: Type.Number(),
        source: Type.Optional(Type.Union([Type.Literal("whatsapp_location"), Type.Literal("obd")])),
      }),
      async execute({ id, ...body }, config) {
        return callBackend(config, `/crew-members/${id}/telemetry`, {
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
      name: "classify_document",
      label: "Classify Document",
      description:
        "Correct an auto-filed photo's document type once you can tell what it actually is from the image " +
        "description in your context. Every inbound photo is already auto-filed as type='photo' the instant " +
        "it's received — this only upgrades that to a more specific type (receipt, permit, contract, " +
        "insurance_cert, disposal_ticket) when the photo clearly is one of those. Leave equipment/damage/" +
        "job-progress photos alone; 'photo' is already correct for those. No confirmation needed — this " +
        "corrects metadata on an already-filed record, it doesn't create anything new or move inventory/money/schedule.",
      parameters: Type.Object({
        id: Type.String({ description: "The document's UUID (given to you in your context after a photo is filed)." }),
        type: Type.Union(
          ["contract", "permit", "receipt", "disposal_ticket", "insurance_cert"].map((s) => Type.Literal(s)),
        ),
      }),
      async execute({ id, type }, config) {
        return callBackend(config, `/documents/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ type }),
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
      name: "list_my_spend_records",
      label: "List My Spend Records",
      description:
        "List a crew member's own spend records (material/fuel/receipt/other -- for mileage claims use list_pending_confirmations instead, they're tracked separately until approved). Use this when they're asking about a claim's status, or looking for a rejected one to dispute (status: 'rejected', then dispute_rejected_claim). rejection_note has management's reason if status is 'rejected'; dispute_note/disputed_at are set once it's gone through one dispute round.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        status: Type.Optional(
          Type.Union(["pending", "approved", "rejected", "disputed"].map((s) => Type.Literal(s))),
        ),
      }),
      async execute({ crew_member_id, status }, config) {
        const params = new URLSearchParams({ crew_member_id });
        if (status) params.set("status", status);
        return callBackend(config, `/spend-records?${params.toString()}`);
      },
    }),

    tool({
      name: "dispute_rejected_claim",
      label: "Dispute Rejected Claim",
      description:
        "Let a crew member respond to a rejected claim instead of the decision just being final -- use when they push back on a rejection (a mileage claim, or a spend record like a material/fuel/receipt claim). Only works once per claim (one dispute round) and only on a claim that's actually rejected right now. claim_type must match where you found it: 'pending_confirmation' for a mileage claim from list_pending_confirmations, 'spend_record' for anything from list_my_spend_records. crew_member_id must be the claim's own owner -- the backend rejects it otherwise (403), so don't call this on someone else's claim. This puts it back in front of management for a second look and pages them; the crew member will be told the outcome the same way as the first decision.",
      parameters: Type.Object({
        claim_type: Type.Union([Type.Literal("pending_confirmation"), Type.Literal("spend_record")]),
        claim_id: Type.String(),
        crew_member_id: Type.String(),
        note: Type.String({ description: "The crew member's own words on why the rejection should be reconsidered." }),
      }),
      async execute({ claim_type, claim_id, crew_member_id, note }, config) {
        const path =
          claim_type === "pending_confirmation"
            ? `/pending-confirmations/${claim_id}/dispute`
            : `/spend-records/${claim_id}/dispute`;
        return callBackend(config, path, {
          method: "PATCH",
          body: JSON.stringify({ dispute_note: note, crew_member_id }),
        });
      },
    }),

    // --- System ---

    tool({
      name: "get_dashboard_url",
      label: "Get Dashboard URL",
      description:
        "Get the current web dashboard URL to share when someone asks for 'the dashboard' or 'the app'. The dashboard runs behind a Cloudflare Quick Tunnel that mints a new random URL on every restart — this is why the URL always has to be looked up fresh, never memorized. Also tells you whether it was reachable on the last health check (run every 5 minutes) — if not, say so plainly rather than handing out a link that might be dead. When you DO share a working link, mention that if it doesn't load, saying so lets you restart it (restart_dashboard_tunnel).",
      parameters: Type.Object({}),
      async execute(_input, config) {
        return callBackend(config, "/system/dashboard-url");
      },
    }),

    tool({
      name: "get_backup_status",
      label: "Get Backup Status",
      description:
        "Get the nightly database backup's last outcome, when asked whether backups are working. last_success_at is when it last actually completed; last_attempt_at may be more recent if the most recent run failed (check last_error). A null last_success_at, or one more than ~30 hours old, means the backup isn't running reliably -- say so plainly rather than assuming it's fine.",
      parameters: Type.Object({}),
      async execute(_input, config) {
        return callBackend(config, "/system/backup-status");
      },
    }),

    tool({
      name: "get_model_usage_summary",
      label: "Get Model Usage Summary",
      description:
        "Get token usage and API cost, grouped by provider/model/month, when asked what this is costing or how much has been used. date_from/date_to filter the range (omit for all recorded history). Figures come from a nightly aggregation of real session transcripts, not an estimate.",
      parameters: Type.Object({
        date_from: Type.Optional(Type.String({ description: "ISO date." })),
        date_to: Type.Optional(Type.String({ description: "ISO date." })),
      }),
      async execute({ date_from, date_to }, config) {
        const params = new URLSearchParams();
        if (date_from) params.set("date_from", date_from);
        if (date_to) params.set("date_to", date_to);
        const qs = params.toString();
        return callBackend(config, `/reports/model-usage${qs ? `?${qs}` : ""}`);
      },
    }),

    // The one tool in this plugin that doesn't just call the backend for
    // its core action -- the OpenClaw gateway (and this plugin, running
    // inside it) is a native systemd service on the Pi host, not a
    // container, so it already has real `docker` CLI access the backend
    // container doesn't. Reuses sync-dashboard-url.mjs's own health-check
    // logic (same script the cron job runs) rather than duplicating it here.
    tool({
      name: "restart_dashboard_tunnel",
      label: "Restart Dashboard Tunnel",
      description:
        "Restart the Cloudflare named tunnel that serves the web dashboard, when someone reports the dashboard link isn't working. The hostname is fixed (dashboard.sodboysltd.org) and doesn't change on restart -- this just reconnects it and confirms it's reachable again. Won't actually restart if one already happened in the last 5 minutes and is currently healthy — returns the current status instead and says so, to avoid needless churn from repeated requests. This changes real infrastructure state, so confirm with the person first before calling it, same as any other action with a real effect.",
      parameters: Type.Object({}),
      async execute(_input, config) {
        const current = (await callBackend(config, "/system/dashboard-url")) as {
          url: string;
          reachable: boolean;
          checked_at: string;
          last_restarted_at: string | null;
        };
        // last_restarted_at, not checked_at -- the routine 5-minute cron
        // poll touches checked_at on every run regardless of whether a
        // restart happened, so checked_at can never tell "just polled"
        // from "just restarted" apart. last_restarted_at is only ever set
        // by this tool's own post-restart sync invocation below.
        const restartedAgoMs = current.last_restarted_at
          ? Date.now() - new Date(current.last_restarted_at).getTime()
          : Infinity;
        if (current.reachable && restartedAgoMs < FIVE_MINUTES_MS) {
          return { ...current, note: "Already restarted within the last 5 minutes and still healthy — not restarting again." };
        }

        const repoDir = process.env.FIELDOPS_REPO_DIR ?? `${process.env.HOME}/fieldops-system`;
        execFileSync("docker", ["compose", "restart", "cloudflared"], { cwd: repoDir, stdio: "pipe" });
        // Give the container time to reconnect the tunnel and for it to
        // actually become reachable before the sync script's health check --
        // empirically closer to 12s than 8s end-to-end on a live test
        // (container start + tunnel negotiation + edge propagation), not
        // just "the container is running again."
        await new Promise((resolve) => setTimeout(resolve, 12000));
        execFileSync("node", [`${repoDir}/openclaw/notifier/sync-dashboard-url.mjs`], {
          env: { ...process.env, AGENT_SERVICE_TOKEN: config.serviceToken ?? "", DASHBOARD_URL_JUST_RESTARTED: "1" },
          stdio: "pipe",
        });
        return callBackend(config, "/system/dashboard-url");
      },
    }),

    tool({
      name: "send_dashboard_login_link",
      label: "Send Dashboard Login Link",
      description:
        "Send a login link for the dashboard's crew view to the person you're talking to, when they ask to see their pay, jobs, checkouts, or claims on the dashboard. Each request mints a fresh link that expires in 15 minutes and can be tapped more than once in that window (not single-use) — but no more than one new link per crew member per 10 minutes; if called again too soon, this returns on_cooldown:true with retry_after_seconds; tell the person plainly that a link was already sent recently and how many minutes until they can request another, don't expose the raw error. Always resolve the sender to a crew_member_id first (per 'Resolving who's messaging you') and pass that id — this logs in as whoever the id belongs to, so it must always be the resolved sender's own id, never someone else's on their behalf.",
      parameters: Type.Object({
        crew_member_id: Type.String({ description: "The resolved sender's own crew_member id." }),
      }),
      async execute({ crew_member_id }, config) {
        const tokenResult = (await callBackend(config, "/auth/login-token", {
          method: "POST",
          body: JSON.stringify({ crew_member_id }),
        })) as { token: string } | { error: true; status: number; message: string };
        if ("error" in tokenResult) {
          if (tokenResult.status === 429) {
            const match = tokenResult.message.match(/(\d+)s$/);
            const retryAfterSeconds = match ? Number(match[1]) : 600;
            return { on_cooldown: true, retry_after_seconds: retryAfterSeconds };
          }
          return { error: true, message: "Couldn't create a login link right now." };
        }
        const dashboardUrlResult = (await callBackend(config, "/system/dashboard-url")) as
          | { url: string }
          | { error: true; status: number; message: string };
        if ("error" in dashboardUrlResult) return { error: true, message: "Couldn't create a login link right now." };
        return { url: `${dashboardUrlResult.url}/api/v1/auth/redeem?token=${tokenResult.token}` };
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
        "List two-party confirm-before-execute requests (hours, material-usage claims, checkout damage/condition claims, mileage claims) awaiting management review, or check the status of ones already decided. whatsapp_message_id matches one by the WhatsApp message id its paging notification was sent under, if the inbound message was a quoted reply to it — see AGENTS.md's 'Approving pending confirmations over WhatsApp' for the full resolution order (id-match first, then status=awaiting_management and act only if exactly one is open). Pass crew_member_id to see one crew member's own requests, e.g. when they're asking about something they submitted, or looking for a rejected one to dispute (status: 'rejected', then dispute_rejected_claim). status 'disputed' means it already went through one round and is awaiting a second look.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union(
            ["awaiting_management", "approved", "rejected", "expired", "disputed"].map((s) => Type.Literal(s)),
          ),
        ),
        whatsapp_message_id: Type.Optional(
          Type.String({ description: "The quoted message's id, if the inbound message was a WhatsApp reply." }),
        ),
        crew_member_id: Type.Optional(Type.String()),
      }),
      async execute({ status, whatsapp_message_id, crew_member_id }, config) {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (whatsapp_message_id) params.set("whatsapp_message_id", whatsapp_message_id);
        if (crew_member_id) params.set("crew_member_id", crew_member_id);
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
        "Reject a pending confirmation on management's behalf. Only a crew member with role 'management' can call this (the backend enforces it — 403 otherwise). The crew member who originally submitted it is told automatically, including the reason if one was given — ask management why before calling this, a bare rejection with no reason invites the same pushback dispute_rejected_claim exists to handle. 400 if already reviewed.",
      parameters: Type.Object({
        id: Type.String(),
        reviewed_by: Type.String({ description: "The management crew member's UUID rejecting it." }),
        reason: Type.Optional(Type.String({ description: "Why it's being rejected, in management's own words." })),
      }),
      async execute({ id, reviewed_by, reason }, config) {
        return callBackend(config, `/pending-confirmations/${id}/reject`, {
          method: "PATCH",
          body: JSON.stringify({ reviewed_by, reason }),
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

    // Carpool: request-based, no auto-matching -- a crew member posts a
    // need or an offer, a human (crew or management) pairs them up with
    // match_ride_requests. None of these four need confirm-before-execute:
    // this is coordination, not money/inventory/schedule -- same tier as
    // log_vehicle_location.
    tool({
      name: "create_ride_request",
      label: "Create Ride Request",
      description:
        "Post that a crew member needs a ride, or can offer one, for a given date. Confirm the date/site/seat details back in plain language before calling this — not the confirm-before-execute gate, but still worth restating what was understood.",
      parameters: Type.Object({
        crew_member_id: Type.String(),
        request_type: Type.Union([Type.Literal("need_ride"), Type.Literal("offering_ride")]),
        date: Type.String({ description: "YYYY-MM-DD." }),
        site_id: Type.Optional(Type.String({ description: "If the site is already known." })),
        seats_available: Type.Optional(Type.Number({ description: "Offers only — how many riders there's room for." })),
        notes: Type.Optional(Type.String()),
      }),
      async execute(body, config) {
        return callBackend(config, "/ride-requests", { method: "POST", body: JSON.stringify(body) });
      },
    }),

    tool({
      name: "list_open_ride_requests",
      label: "List Open Ride Requests",
      description: "List ride requests, optionally filtered by date or status. Use this so a crew member can check what's available without asking a human to look it up.",
      parameters: Type.Object({
        date: Type.Optional(Type.String({ description: "YYYY-MM-DD." })),
        status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("matched"), Type.Literal("cancelled")])),
      }),
      async execute({ date, status }, config) {
        const params = new URLSearchParams();
        if (date) params.set("date", date);
        if (status) params.set("status", status);
        const qs = params.toString();
        return callBackend(config, `/ride-requests${qs ? `?${qs}` : ""}`);
      },
    }),

    tool({
      name: "match_ride_requests",
      label: "Match Ride Requests",
      description: "Pair an open 'need a ride' request with an open 'offering a ride' request — both must currently be open, and one of each type. Sets both to matched.",
      parameters: Type.Object({
        id: Type.String({ description: "One of the two ride_requests ids." }),
        matched_with_id: Type.String({ description: "The other ride_requests id." }),
      }),
      async execute({ id, matched_with_id }, config) {
        return callBackend(config, `/ride-requests/${id}/match`, {
          method: "PATCH",
          body: JSON.stringify({ matched_with_id }),
        });
      },
    }),

    tool({
      name: "cancel_ride_request",
      label: "Cancel Ride Request",
      description: "Cancel an open or matched ride request (e.g. plans changed).",
      parameters: Type.Object({ id: Type.String() }),
      async execute({ id }, config) {
        return callBackend(config, `/ride-requests/${id}/cancel`, { method: "PATCH" });
      },
    }),

    // No new schema -- reuses crew_telemetry/vehicle_telemetry directly.
    // Resolves the matched offer's driver (following matched_request_id),
    // then whichever location source they actually have: their own
    // crew_telemetry, falling back to an assigned vehicle's telemetry.
    tool({
      name: "get_ride_driver_location",
      label: "Get Ride Driver Location",
      description: "Get a matched ride's driver's current location — resolves the matched 'offering_ride' request's driver, then returns their latest location (person-level if they've shared one, otherwise their assigned vehicle's).",
      parameters: Type.Object({
        ride_request_id: Type.String({ description: "Either side of a matched pair — need or offer." }),
      }),
      async execute({ ride_request_id }, config) {
        const requests = (await callBackend(config, "/ride-requests")) as any[];
        if (!Array.isArray(requests)) return { error: true, message: "Couldn't look up ride requests." };
        const mine = requests.find((r) => r.id === ride_request_id);
        if (!mine) return { error: true, message: "Ride request not found." };
        const offer = mine.request_type === "offering_ride" ? mine : requests.find((r) => r.id === mine.matched_request_id);
        if (!offer || offer.request_type !== "offering_ride") {
          return { error: true, message: "This ride request isn't matched to a driver." };
        }
        const crewLocation = await callBackend(config, `/crew-members/${offer.crew_member_id}/telemetry`);
        if (crewLocation && typeof crewLocation === "object" && "lat" in crewLocation) {
          return { driver_name: offer.crew_member_name, source: "crew_location", location: crewLocation };
        }
        const vehicles = (await callBackend(config, `/vehicles?assigned_crew_id=${offer.crew_member_id}`)) as any[];
        const vehicle = Array.isArray(vehicles) ? vehicles[0] : undefined;
        if (vehicle?.latest_location) {
          return { driver_name: offer.crew_member_name, source: "vehicle_location", location: vehicle.latest_location };
        }
        return { driver_name: offer.crew_member_name, error: true, message: "No location shared yet by the driver." };
      },
    }),

    // Every proactive message the agent wants to send -- a scheduled
    // digest's group post or its management/owner/IT DM, a critical alert,
    // anything not a direct reply within an ongoing conversation -- goes
    // through this draft-and-approve flow instead of being sent directly.
    // Built after a live incident: a scheduled digest posted hallucinated
    // content, and a separate run leaked its own tool-call narration as
    // literal message text, neither of which a human ever saw before it
    // would have gone out. create_message_draft only ever writes state (the
    // backend container has no path to the `openclaw` CLI); the actual send
    // happens in resolve_message_draft below, which runs host-side in this
    // same plugin process, same reasoning as restart_dashboard_tunnel's
    // `docker` shell-out just above.
    tool({
      name: "create_message_draft",
      label: "Create Message Draft",
      description:
        "Submit a proactive outbound message (a scheduled digest's group post or management/owner/IT summary, a critical alert, anything you're initiating rather than replying to) for IT's review before it's sent. Never delivers anything itself -- IT sees the draft and calls resolve_message_draft to approve (as-is or edited) or reject it. Use this from the three scheduled digest routines and any other proactive notification instead of sending directly. Does not apply to a normal reply within an ongoing conversation someone else started -- that still goes out as your own turn's reply, unedited.",
      parameters: Type.Object({
        source: Type.String({ description: "Short machine label for what generated this, e.g. 'digest_morning_group', 'digest_evening_management', 'critical_notification'." }),
        target_description: Type.String({ description: "Human-readable description of who this would go to, e.g. \"Crew group\" or \"Management, Owner, IT\"." }),
        target_group_jid: Type.Optional(Type.String({ description: "WhatsApp group JID, if this is a group post. Exactly one of target_group_jid/target_roles must be set." })),
        target_roles: Type.Optional(Type.Array(Type.String(), { description: "Crew roles to DM if approved, e.g. [\"management\",\"owner\",\"IT\"]. Exactly one of target_group_jid/target_roles must be set." })),
        draft_text: Type.String({ description: "The proposed message text, verbatim." }),
      }),
      async execute({ source, target_description, target_group_jid, target_roles, draft_text }, config) {
        return callBackend(config, "/system/message-drafts", {
          method: "POST",
          body: JSON.stringify({ source, target_description, target_group_jid, target_roles, draft_text }),
        });
      },
    }),

    tool({
      name: "list_pending_message_drafts",
      label: "List Pending Message Drafts",
      description: "List every message draft still awaiting IT's decision. Use this to find a draft's id when IT refers to one conversationally (\"approve the group one\", \"what's pending\").",
      parameters: Type.Object({}),
      async execute(_input, config) {
        return callBackend(config, "/system/message-drafts?status=pending");
      },
    }),

    // The actual send lives here, not in create_message_draft -- this tool
    // is the one place a proactive message ever really goes out, and it
    // only runs after IT's explicit decision.
    tool({
      name: "resolve_message_draft",
      label: "Resolve Message Draft",
      description:
        "Approve or reject a pending message draft. Only call this on IT's explicit instruction -- never assume approval. To approve as written, call with action='approve' and no final_text. To approve an edited version, call with action='approve' and final_text set to the revised message (IT's edit wins verbatim, don't paraphrase it further). action='reject' discards it -- nothing is sent. On approval, this actually delivers the message to the draft's original target (the group or the role-queried recipients) -- there is no further step after this.",
      parameters: Type.Object({
        id: Type.String({ description: "The message_drafts row id, from list_pending_message_drafts." }),
        action: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
        final_text: Type.Optional(Type.String({ description: "IT's edited message text, if they revised the draft. Omit to send the draft unchanged." })),
      }),
      async execute({ id, action, final_text }, config) {
        const resolved = (await callBackend(config, `/system/message-drafts/${id}/resolve`, {
          method: "PATCH",
          body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected", final_text }),
        })) as { error?: true; message?: string; final_text?: string; target_group_jid?: string | null; target_roles?: string[] | null };
        if ("error" in resolved && resolved.error) return resolved;
        if (action === "reject") return { rejected: true };

        const text = resolved.final_text ?? "";
        const targets = new Set<string>();
        if (resolved.target_group_jid) {
          targets.add(resolved.target_group_jid);
        } else if (resolved.target_roles) {
          for (const role of resolved.target_roles) {
            const members = await callBackend(config, `/crew-members?role=${encodeURIComponent(role)}&active=true`);
            if (!Array.isArray(members)) continue;
            for (const member of members as { phone?: string }[]) {
              if (member.phone) targets.add(member.phone);
            }
          }
        }
        let sent = 0;
        const failures: string[] = [];
        for (const target of targets) {
          try {
            execFileSync(
              process.env.OPENCLAW_BIN ?? "openclaw",
              ["message", "send", "--channel", "whatsapp", "--target", target, "--message", text, "--json"],
              { stdio: "pipe" },
            );
            sent += 1;
          } catch {
            failures.push(target);
          }
        }
        return { sent_to: sent, recipient_count: targets.size, failures };
      },
    }),

    tool({
      name: "report_it_issue",
      label: "Report IT Issue",
      description:
        "Push an instant critical alert to IT for a system/technical problem -- the dashboard is broken, the WhatsApp bot is acting up, a device won't connect, anything infrastructure-related. Not for physical safety (use report_safety_incident) and not a business/operational complaint (those go through normal conversation). See AGENTS.md's 'Escalating an IT issue' -- overrides confirm-before-execute, call it immediately once you understand the problem.",
      parameters: Type.Object({
        message: Type.String({ description: "Brief summary of the problem reported." }),
        crew_member_id: Type.Optional(Type.String({ description: "The reporting crew member's UUID, if resolved." })),
      }),
      async execute({ message, crew_member_id }, config) {
        return callBackend(config, "/system/it-issue", {
          method: "POST",
          body: JSON.stringify({ message, crew_member_id }),
        });
      },
    }),
  ],
});
