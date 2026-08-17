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

// Mirrors backend/src/routes/users.ts's USER_ROLES.
export const USER_ROLES = ["admin", "staff", "owner"] as const;

export type Me =
  | { identityType: "dashboard"; id: string; email: string; name: string; role: (typeof USER_ROLES)[number] }
  | { identityType: "crew"; id: string; name: string; role: (typeof CREW_ROLES)[number] };

export type MyPay = {
  profile: { pay_type: "payroll" | "cash"; hourly_rate: number | null; updated_at: string | null };
  payouts: { id: string; amount: number; paid_at: string; note: string | null }[];
};
export type MyShifts = {
  shifts: (Shift & { site_name: string | null })[];
  timeclock_sessions: TimeclockSession[];
};
export type MyCheckout = {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_category: string;
  checked_out_at: string;
  checked_in_at: string | null;
  expected_return_at: string | null;
  damage_flag: boolean;
  damage_note: string | null;
};
export type MySpendRecord = SpendRecord & { document_filename: string | null };

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

export type RideRequest = {
  id: string;
  crew_member_id: string;
  crew_member_name: string;
  crew_member_phone: string;
  request_type: "need_ride" | "offering_ride";
  date: string;
  site_id: string | null;
  site_name: string | null;
  seats_available: number | null;
  notes: string | null;
  status: "open" | "matched" | "cancelled";
  matched_request_id: string | null;
  created_at: string;
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

export type OrderItem = {
  id: string;
  order_id: string;
  asset_id: string | null;
  consumable_id: string | null;
  quantity: number;
  unit_cost: number | null;
  item_name: string | null;
};

export type OrderDetail = Order & { items: OrderItem[] };

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
  service_interval_days: number | null;
  last_serviced_at: string | null;
  next_service_due: string | null;
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
export const CREW_ROLES = ["crew", "foreman", "yard", "management", "owner", "IT"] as const;

// Mirrors backend/src/lib/notificationSettings.ts's NotificationSettings.
export type NotificationSettings = {
  escalation_threshold_minutes: number;
  max_escalations: number;
  vehicle_dark_critical: boolean;
  critical_notification_roles: (typeof CREW_ROLES)[number][];
  it_escalation_roles: (typeof CREW_ROLES)[number][];
  order_stall_hours: number;
  idle_hours: number;
  delay_buffer_minutes: number;
  rain_probability_threshold: number;
  wind_speed_threshold_kmh: number;
  daily_overtime_hours: number;
  break_required_after_hours: number;
  updated_at: string;
};

export const PREFERRED_LANGUAGES = ["en", "fr"] as const;

export type CrewMember = {
  id: string;
  name: string;
  phone: string;
  role: (typeof CREW_ROLES)[number];
  active: boolean;
  created_at: string;
  preferred_language: (typeof PREFERRED_LANGUAGES)[number] | null;
};

// Foreman/management/owner-tier crew-session views (see docs/API.md's "My
// Stuff" section) -- everyone with a confirmed shift at the caller's site(s)
// today, not just the caller. Distinct from MyCheckout/MyShifts above,
// which are always scoped to the caller only.
export type MySiteRosterEntry = {
  crew_member_id: string;
  name: string;
  role: (typeof CREW_ROLES)[number];
  site_id: string;
  site_name: string;
  last_event_type: string | null;
  last_event_at: string | null;
};

export type MySiteCheckout = MyCheckout & { checked_out_by: string; checked_out_by_name: string };

export type MySiteOrder = Order & { created_at: string; items: OrderItem[] };

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
  fulfilled_at: string | null;
  fulfilled_by_name: string | null;
};

export type PurchaseOrderDetail = PurchaseOrder & { items: PurchaseOrderItem[] };

export type User = {
  id: string;
  email: string;
  name: string;
  role: (typeof USER_ROLES)[number];
  active: boolean;
  created_at: string;
};

export const PAY_TYPES = ["payroll", "cash"] as const;

export type PayProfile = {
  crew_member_id: string;
  crew_member_name: string;
  pay_type: (typeof PAY_TYPES)[number];
  hourly_rate: number | null;
  updated_at: string | null;
};

export type Payout = {
  id: string;
  crew_member_id: string;
  crew_member_name: string;
  amount: number;
  paid_at: string;
  note: string | null;
  recorded_by_user_id: string;
  recorded_by_name: string;
  created_at: string;
};

export type ReconciliationRow = {
  crew_member_id: string;
  crew_member_name: string;
  pay_type: (typeof PAY_TYPES)[number];
  hourly_rate: number | null;
  completed_hours: number;
  incomplete_sessions: number;
  amount_owed: number | null;
  amount_paid: number;
  difference: number | null;
};

export const INSTRUMENT_TYPES = ["company_card", "petty_cash"] as const;

export type MoneyInstrument = {
  id: string;
  type: (typeof INSTRUMENT_TYPES)[number];
  label: string;
  balance: number | null;
  active: boolean;
  current_holder_name: string | null;
};

export const SPEND_METHODS = ["cash", "company_card", "personal_reimbursed"] as const;
export const SPEND_CATEGORIES = ["material", "fuel", "mileage", "receipt", "other"] as const;
export const SPEND_STATUSES = ["pending", "approved", "rejected", "disputed"] as const;

export type SpendRecord = {
  id: string;
  category: (typeof SPEND_CATEGORIES)[number];
  method: (typeof SPEND_METHODS)[number];
  status: (typeof SPEND_STATUSES)[number];
  amount: number | null;
  distance_km: number | null;
  rate_per_km: number | null;
  description: string | null;
  document_id: string | null;
  document_filename: string | null;
  instrument_id: string | null;
  instrument_label: string | null;
  crew_member_id: string | null;
  crew_member_name: string | null;
  submitted_by: string | null;
  submitted_by_user_id: string | null;
  submitted_by_name: string;
  occurred_at: string;
  reviewed_by: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  dispute_note: string | null;
  disputed_at: string | null;
  created_at: string;
};

export type PeriodCloseJob = {
  id: string;
  date: string;
  site_name: string | null;
  job_type_name: string | null;
  completed_at: string;
  completed_by_name: string | null;
};

export type PeriodCloseHours = {
  crew_member_id: string;
  crew_member_name: string;
  completed_hours: number;
  incomplete_sessions: number;
};

export type PeriodCloseSpend = {
  category: (typeof SPEND_CATEGORIES)[number];
  count: number;
  total_amount: number;
};

export type PeriodCloseAlert = {
  id: string;
  type: string;
  site_name: string | null;
  raised_at: string;
  resolved_at: string | null;
};

export type PeriodCloseSummary = {
  date_from: string;
  date_to: string;
  jobs: PeriodCloseJob[];
  hours: PeriodCloseHours[];
  spend: PeriodCloseSpend[];
  missing_receipts: { count: number; total_amount: number; records: SpendRecord[] };
  anomalies: { by_type: { type: string; count: number }[]; alerts: PeriodCloseAlert[] };
};

export type VendorSpendRow = {
  vendor_name: string;
  month: string;
  po_count: number;
  total_cost: number;
};

export type ModelUsageRow = {
  provider: string;
  model: string;
  month: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

export type OrderReconciliationRow = {
  order_item_id: string;
  order_id: string;
  date_needed: string | null;
  order_status: string;
  site_name: string | null;
  item_name: string | null;
  item_type: "asset" | "consumable";
  requested_quantity: number;
  purchased_quantity: number | null;
  purchase_order_id: string | null;
  po_status: string | null;
  vendor_name: string | null;
};

export type PayrollExportRow = {
  crew_member_name: string;
  hourly_rate: number | null;
  hours_worked: number;
  gross_pay: number | null;
  incomplete_sessions: number;
  period_start: string | null;
  period_end: string | null;
};

export type ClaimOutcomeRow = {
  crew_member_id: string;
  crew_member_name: string;
  approved_count: number;
  rejected_count: number;
  disputed_count: number;
  total_count: number;
};

export const CONFIRMATION_ACTION_TYPES = [
  "timeclock_event",
  "consumable_adjustment",
  "checkout_return",
  "mileage_claim",
  "asset_verification",
  "purchase_order_fulfillment",
] as const;
export const CONFIRMATION_STATUSES = [
  "awaiting_management",
  "approved",
  "rejected",
  "expired",
  "disputed",
] as const;

export type PendingConfirmation = {
  id: string;
  action_type: (typeof CONFIRMATION_ACTION_TYPES)[number];
  summary: string;
  payload: Record<string, unknown>;
  crew_member_id: string;
  crew_member_name: string | null;
  status: (typeof CONFIRMATION_STATUSES)[number];
  notification_id: string;
  reviewed_by: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  dispute_note: string | null;
  disputed_at: string | null;
  result_id: string | null;
  crew_notified_at: string | null;
  created_at: string;
};

export const ACTIVITY_EVENT_TYPES = [
  "job_started",
  "job_completed",
  "checkout_created",
  "checkout_returned",
  "asset_verified",
  "alert_resolved",
  "notification_acknowledged",
  "document_uploaded",
] as const;

export type ActivityEvent = {
  event_type: (typeof ACTIVITY_EVENT_TYPES)[number];
  occurred_at: string;
  actor_name: string | null;
  description: string;
};

export type TimeclockSession = {
  crew_member_id: string;
  started_at: string;
  ended_at: string | null;
  break_seconds: number;
  net_seconds: number | null;
  site_ids: string[];
  geofence_verified: boolean;
  incomplete: boolean;
  overtime: boolean;
  missed_break: boolean;
};

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
  myPay: () => request<MyPay>("/me/pay"),
  myShifts: () => request<MyShifts>("/me/shifts"),
  myCheckouts: () => request<MyCheckout[]>("/me/checkouts"),
  mySpendRecords: () => request<MySpendRecord[]>("/me/spend-records"),
  mySiteRoster: () => request<MySiteRosterEntry[]>("/me/site-roster"),
  mySiteCheckouts: () => request<MySiteCheckout[]>("/me/site-checkouts"),
  mySiteOrders: () => request<MySiteOrder[]>("/me/site-orders"),
  vehicles: () => request<Vehicle[]>("/vehicles"),
  rideRequests: (params?: { status?: string; date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.date) qs.set("date", params.date);
    const suffix = qs.toString();
    return request<RideRequest[]>(`/ride-requests${suffix ? `?${suffix}` : ""}`);
  },
  shiftsToday: () => request<Shift[]>(`/shifts?date=${todayIso()}`),
  createShiftsBatch: (
    shifts: {
      crew_member_id: string;
      site_id: string;
      date: string;
      start_time?: string;
      end_time?: string;
    }[],
  ) => request<Shift[]>("/shifts/batch", { method: "POST", body: JSON.stringify({ shifts }) }),
  unresolvedAlerts: () => request<Alert[]>("/alerts?resolved=false"),
  orders: () => request<Order[]>("/orders"),
  orderDetail: (id: string) => request<OrderDetail>(`/orders/${id}`),
  updateOrderItem: (id: string, unitCost: number) =>
    request<OrderItem>(`/order-items/${id}`, { method: "PATCH", body: JSON.stringify({ unit_cost: unitCost }) }),
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
  setAssetMaintenanceSchedule: (id: string, serviceIntervalDays: number | null) =>
    request<Asset>(`/assets/${id}/maintenance-schedule`, {
      method: "PATCH",
      body: JSON.stringify({ service_interval_days: serviceIntervalDays }),
    }),
  logAssetService: (id: string) => request<Asset>(`/assets/${id}/log-service`, { method: "POST" }),
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
  users: () => request<User[]>("/users"),
  createUser: (body: { name: string; email: string; password: string; role?: User["role"] }) =>
    request<User>("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, patch: Partial<Pick<User, "name" | "email" | "active" | "role">>) =>
    request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  setUserPassword: (id: string, newPassword: string) =>
    request<User>(`/users/${id}/password`, { method: "PATCH", body: JSON.stringify({ new_password: newPassword }) }),
  activity: (filters: { event_type?: string; since?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.event_type) params.set("event_type", filters.event_type);
    if (filters.since) params.set("since", filters.since);
    if (filters.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request<ActivityEvent[]>(`/activity${qs ? `?${qs}` : ""}`);
  },
  timeclockSessions: (filters: { crew_member_id?: string; date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.crew_member_id) params.set("crew_member_id", filters.crew_member_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<TimeclockSession[]>(`/timesheets/sessions${qs ? `?${qs}` : ""}`);
  },
  notificationSettings: () => request<NotificationSettings>("/notification-settings"),
  updateNotificationSettings: (patch: Partial<Omit<NotificationSettings, "updated_at">>) =>
    request<NotificationSettings>("/notification-settings", { method: "PATCH", body: JSON.stringify(patch) }),
  payProfiles: () => request<PayProfile[]>("/crew-members/pay-profiles"),
  updatePayProfile: (crewMemberId: string, patch: { pay_type?: PayProfile["pay_type"]; hourly_rate?: number | null }) =>
    request<Omit<PayProfile, "crew_member_name">>(`/crew-members/${crewMemberId}/pay-profile`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  createPayout: (body: { crew_member_id: string; amount: number; paid_at?: string; note?: string }) =>
    request<Payout>("/payouts", { method: "POST", body: JSON.stringify(body) }),
  payouts: (filters: { crew_member_id?: string; date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.crew_member_id) params.set("crew_member_id", filters.crew_member_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<Payout[]>(`/payouts${qs ? `?${qs}` : ""}`);
  },
  payrollReconciliation: (filters: { crew_member_id?: string; date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.crew_member_id) params.set("crew_member_id", filters.crew_member_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<ReconciliationRow[]>(`/payroll/reconciliation${qs ? `?${qs}` : ""}`);
  },
  moneyInstruments: () => request<MoneyInstrument[]>("/money-instruments"),
  createMoneyInstrument: (body: { type: MoneyInstrument["type"]; label: string }) =>
    request<MoneyInstrument>("/money-instruments", { method: "POST", body: JSON.stringify(body) }),
  assignMoneyInstrument: (id: string, heldBy: string) =>
    request<unknown>(`/money-instruments/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ held_by: heldBy }),
    }),
  adjustMoneyInstrumentBalance: (id: string, delta: number) =>
    request<MoneyInstrument>(`/money-instruments/${id}/balance`, {
      method: "PATCH",
      body: JSON.stringify({ delta }),
    }),
  createSpendRecord: (body: {
    category: SpendRecord["category"];
    method: SpendRecord["method"];
    amount?: number;
    distance_km?: number;
    description?: string;
    document_id?: string;
    instrument_id?: string;
    crew_member_id?: string;
    occurred_at?: string;
  }) => request<SpendRecord>("/spend-records", { method: "POST", body: JSON.stringify(body) }),
  spendRecords: (
    filters: {
      category?: string;
      method?: string;
      status?: string;
      crew_member_id?: string;
      date_from?: string;
      date_to?: string;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (filters.category) params.set("category", filters.category);
    if (filters.method) params.set("method", filters.method);
    if (filters.status) params.set("status", filters.status);
    if (filters.crew_member_id) params.set("crew_member_id", filters.crew_member_id);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<SpendRecord[]>(`/spend-records${qs ? `?${qs}` : ""}`);
  },
  missingReceipts: (filters: { category?: string; date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.category) params.set("category", filters.category);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<SpendRecord[]>(`/spend-records/missing-receipts${qs ? `?${qs}` : ""}`);
  },
  periodCloseSummary: (dateFrom: string, dateTo: string) =>
    request<PeriodCloseSummary>(`/reports/period-close?date_from=${dateFrom}&date_to=${dateTo}`),
  vendorSpendSummary: (filters: { date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<VendorSpendRow[]>(`/reports/vendor-spend${qs ? `?${qs}` : ""}`);
  },
  modelUsageSummary: (filters: { date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<ModelUsageRow[]>(`/reports/model-usage${qs ? `?${qs}` : ""}`);
  },
  orderReconciliationSummary: (filters: { date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<OrderReconciliationRow[]>(`/reports/order-reconciliation${qs ? `?${qs}` : ""}`);
  },
  payrollExportSummary: (filters: { date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<PayrollExportRow[]>(`/reports/payroll-export${qs ? `?${qs}` : ""}`);
  },
  claimOutcomesSummary: (filters: { date_from?: string; date_to?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    const qs = params.toString();
    return request<ClaimOutcomeRow[]>(`/reports/claim-outcomes${qs ? `?${qs}` : ""}`);
  },
  approveSpendRecord: (id: string, ratePerKm?: number) =>
    request<SpendRecord>(`/spend-records/${id}/approve`, {
      method: "PATCH",
      body: JSON.stringify(ratePerKm !== undefined ? { rate_per_km: ratePerKm } : {}),
    }),
  rejectSpendRecord: (id: string, reason?: string) =>
    request<SpendRecord>(`/spend-records/${id}/reject`, {
      method: "PATCH",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  pendingConfirmations: (status?: string) =>
    request<PendingConfirmation[]>(`/pending-confirmations${status ? `?status=${status}` : ""}`),
  approvePendingConfirmation: (id: string, ratePerKm?: number) =>
    request<PendingConfirmation>(`/pending-confirmations/${id}/approve`, {
      method: "PATCH",
      body: JSON.stringify(ratePerKm !== undefined ? { rate_per_km: ratePerKm } : {}),
    }),
  rejectPendingConfirmation: (id: string, reason?: string) =>
    request<PendingConfirmation>(`/pending-confirmations/${id}/reject`, {
      method: "PATCH",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
};
