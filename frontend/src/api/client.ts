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
  site_name: string | null;
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
};
