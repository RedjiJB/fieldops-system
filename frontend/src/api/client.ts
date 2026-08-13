const BASE_URL = "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string })?.error ?? res.statusText);
  }
  return body as T;
}

export type Me = { id: string; email: string; name: string };

export type VehicleLocation = {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  timestamp: string;
};

export type Vehicle = {
  id: string;
  plate: string;
  assigned_crew_id: string | null;
  current_mileage: number | null;
  latest_location: VehicleLocation | null;
};

export type Trip = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  purpose_tag: string | null;
  site_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
};

export type Shift = {
  id: string;
  crew_member_id: string;
  site_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  crew_member_name: string | null;
  crew_member_phone: string | null;
  site_name: string | null;
  nudged_at: string | null;
};

export type Alert = {
  id: string;
  type: string;
  site_id: string | null;
  raised_at: string;
  resolved_at: string | null;
};

// Mirrors backend/src/routes/orders.ts's ORDER_STATUSES — forward-only, no
// shared-types mechanism between frontend/backend in this repo.
export const ORDER_STATUSES = ["requested", "confirmed", "picked", "loaded", "in_field", "returned"] as const;

export type Order = {
  id: string;
  status: (typeof ORDER_STATUSES)[number];
  site_id: string | null;
  requester_id: string;
  date_needed: string | null;
  site_name: string | null;
  requester_name: string | null;
};

export type Notification = {
  id: string;
  priority: "critical" | "routine";
  message: string;
  source_type: string;
  source_id: string | null;
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  escalated_count: number;
};

// Mirrors backend/src/routes/assets.ts's ASSET_STATUSES. 'available' is
// excluded from DIRECTLY_SETTABLE_STATUSES backend-side (only /verify can
// reach it) -- the dashboard never offers it as a status-change target,
// same reason it never offers a "Verify" action at all (see AssetsPage.tsx).
export const ASSET_STATUSES = [
  "available",
  "checked_out",
  "missing",
  "in_maintenance",
  "unconfirmed",
  "retired",
] as const;
export const ASSET_DIRECTLY_SETTABLE_STATUSES = ASSET_STATUSES.filter((s) => s !== "available");

export type Asset = {
  id: string;
  name: string;
  category: string;
  qr_tag_id: string;
  status: (typeof ASSET_STATUSES)[number];
  current_site_id: string | null;
  current_site_name: string | null;
  current_holder: string | null;
  current_holder_name: string | null;
  last_verified_at: string | null;
  created_at: string;
};

export const DOCUMENT_TYPES = [
  "contract",
  "permit",
  "photo",
  "receipt",
  "disposal_ticket",
  "insurance_cert",
] as const;

// Mirrors backend/src/routes/crewMembers.ts's CREW_ROLES.
export const CREW_ROLES = ["crew", "crew_lead", "yard", "management"] as const;

export type CrewMember = {
  id: string;
  name: string;
  phone: string;
  role: (typeof CREW_ROLES)[number];
  active: boolean;
  created_at: string;
};

// Mirrors backend/src/routes/sites.ts's SITE_TYPES.
export const SITE_TYPES = ["job_site", "depot", "vendor", "shop"] as const;

export type Site = {
  id: string;
  name: string;
  type: (typeof SITE_TYPES)[number];
  address: string | null;
  access_instructions: string | null;
  access_hours: string | null;
  center_lat: number | null;
  center_lng: number | null;
  geofence_radius_m: number | null;
  geofence_polygon: unknown | null;
  active_start: string | null;
  active_end: string | null;
};

export type JobType = { id: string; name: string };

// Mirrors backend/src/routes/consumables.ts's STOCKING_TYPES.
export const STOCKING_TYPES = ["stocked", "per_job_delivery"] as const;

export type Consumable = {
  id: string;
  name: string;
  stocking_type: (typeof STOCKING_TYPES)[number];
  quantity_on_hand: number | null;
  last_verified_at: string | null;
};

export type Loadout = {
  id: string;
  name: string;
  job_type_id: string | null;
};

export type LoadoutItem = {
  id: string;
  loadout_id: string;
  asset_id: string | null;
  consumable_id: string | null;
  quantity: number;
  scales_with_crew: boolean;
  item_name: string;
};

export type LoadoutDetail = Loadout & { items: LoadoutItem[] };

export type NewLoadoutItem = {
  asset_id?: string;
  consumable_id?: string;
  quantity: number;
  scales_with_crew?: boolean;
};

export type Vendor = {
  id: string;
  name: string;
  contact_method: string | null;
  contact_address: string | null;
  account_number: string | null;
  lead_time_days: number | null;
};

// Mirrors backend/src/routes/vendors.ts's po_status enum.
export const PO_STATUSES = ["compiled", "sent_to_office", "forwarded_by_office", "fulfilled"] as const;

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  description: string;
  quantity: number | null;
};

export type PurchaseOrder = {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  order_id: string | null;
  site_id: string | null;
  site_name: string | null;
  status: (typeof PO_STATUSES)[number];
  cost: number | null;
  eta: string | null;
  sent_to: string | null;
  created_at: string;
};

export type PurchaseOrderDetail = PurchaseOrder & { items: PurchaseOrderItem[] };

export type Document = {
  id: string;
  site_id: string | null;
  site_name: string | null;
  type: (typeof DOCUMENT_TYPES)[number];
  filename: string;
  mime_type: string | null;
  uploaded_at: string;
  tags: string[] | null;
  expiry_date: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const api = {
  login: (email: string, password: string) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<Me>("/auth/me"),
  vehicles: () => request<Vehicle[]>("/vehicles"),
  shiftsToday: () => request<Shift[]>(`/shifts?date=${todayIso()}`),
  unresolvedAlerts: () => request<Alert[]>("/alerts?resolved=false"),
  orders: () => request<Order[]>("/orders"),
  resolveAlert: (id: string) => request<Alert>(`/alerts/${id}/resolve`, { method: "PATCH" }),
  advanceOrder: (id: string, status: string) =>
    request<Order>(`/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  notifications: () => request<Notification[]>("/notifications"),
  acknowledgeNotification: (id: string) =>
    request<Notification>(`/notifications/${id}/acknowledge`, { method: "PATCH" }),
  assets: (filters: { status?: string; site_id?: string; category?: string }) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.site_id) params.set("site_id", filters.site_id);
    if (filters.category) params.set("category", filters.category);
    const qs = params.toString();
    return request<Asset[]>(`/assets${qs ? `?${qs}` : ""}`);
  },
  updateAssetStatus: (id: string, status: string) =>
    request<Asset>(`/assets/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  documents: (filters: { site_id?: string; type?: string }) => {
    const params = new URLSearchParams();
    if (filters.site_id) params.set("site_id", filters.site_id);
    if (filters.type) params.set("type", filters.type);
    const qs = params.toString();
    return request<Document[]>(`/documents${qs ? `?${qs}` : ""}`);
  },
  expiringDocuments: (withinDays: number) =>
    request<Document[]>(`/documents/expiring?within_days=${withinDays}`),
  sites: (filters: { type?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.type) params.set("type", filters.type);
    const qs = params.toString();
    return request<Site[]>(`/sites${qs ? `?${qs}` : ""}`);
  },
  updateSite: (id: string, patch: Partial<Site>) =>
    request<Site>(`/sites/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  crewMembers: (filters: { role?: string; active?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.role) params.set("role", filters.role);
    if (filters.active) params.set("active", filters.active);
    const qs = params.toString();
    return request<CrewMember[]>(`/crew-members${qs ? `?${qs}` : ""}`);
  },
  updateCrewMember: (id: string, patch: Partial<CrewMember>) =>
    request<CrewMember>(`/crew-members/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  vehicleTrips: (vehicleId: string) => request<Trip[]>(`/vehicles/${vehicleId}/trips`),
  jobTypes: () => request<JobType[]>("/job-types"),
  consumables: (filters: { stocking_type?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.stocking_type) params.set("stocking_type", filters.stocking_type);
    const qs = params.toString();
    return request<Consumable[]>(`/consumables${qs ? `?${qs}` : ""}`);
  },
  loadouts: (filters: { job_type_id?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.job_type_id) params.set("job_type_id", filters.job_type_id);
    const qs = params.toString();
    return request<Loadout[]>(`/loadouts${qs ? `?${qs}` : ""}`);
  },
  loadout: (id: string) => request<LoadoutDetail>(`/loadouts/${id}`),
  createLoadout: (body: { name: string; job_type_id?: string | null; items: NewLoadoutItem[] }) =>
    request<LoadoutDetail>("/loadouts", { method: "POST", body: JSON.stringify(body) }),
  updateLoadout: (id: string, patch: Partial<Pick<Loadout, "name" | "job_type_id">>) =>
    request<Loadout>(`/loadouts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLoadout: (id: string) => request<void>(`/loadouts/${id}`, { method: "DELETE" }),
  addLoadoutItem: (loadoutId: string, item: NewLoadoutItem) =>
    request<LoadoutItem>(`/loadouts/${loadoutId}/items`, { method: "POST", body: JSON.stringify(item) }),
  updateLoadoutItem: (id: string, patch: { quantity?: number; scales_with_crew?: boolean }) =>
    request<LoadoutItem>(`/loadout-items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLoadoutItem: (id: string) => request<void>(`/loadout-items/${id}`, { method: "DELETE" }),
  vendors: () => request<Vendor[]>("/vendors"),
  vendor: (id: string) => request<Vendor>(`/vendors/${id}`),
  createVendor: (body: Omit<Vendor, "id">) =>
    request<Vendor>("/vendors", { method: "POST", body: JSON.stringify(body) }),
  updateVendor: (id: string, patch: Partial<Omit<Vendor, "id">>) =>
    request<Vendor>(`/vendors/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  purchaseOrders: (filters: { status?: string; vendor_id?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.vendor_id) params.set("vendor_id", filters.vendor_id);
    const qs = params.toString();
    return request<PurchaseOrder[]>(`/purchase-orders${qs ? `?${qs}` : ""}`);
  },
  purchaseOrder: (id: string) => request<PurchaseOrderDetail>(`/purchase-orders/${id}`),
  sendPurchaseOrder: (id: string, sentTo: string) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/send`, {
      method: "POST",
      body: JSON.stringify({ sent_to: sentTo }),
    }),
  markPurchaseOrderFulfilled: (id: string) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/fulfilled`, { method: "PATCH" }),
};
