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
  sites: () => request<{ id: string; name: string }[]>("/sites"),
};
