import { useEffect, useState } from "react";
import {
  api,
  type VendorSpendRow,
  type ModelUsageRow,
  type ClaimOutcomeRow,
  type OrderReconciliationRow,
  type PayrollExportRow,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

const sectionStyle = { padding: 16 };
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const thStyle = { textAlign: "left" as const, padding: "6px 10px", fontSize: 13, color: "#888", borderBottom: "1px solid #ddd" };
const tdStyle = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #f0f0f0" };

const REPORT_TYPES = [
  { value: "jobs", label: "Jobs", path: "/api/v1/reports/jobs.csv" },
  { value: "checkouts", label: "Checkouts", path: "/api/v1/reports/checkouts.csv" },
  { value: "purchase-orders", label: "Purchase Orders", path: "/api/v1/reports/purchase-orders.csv" },
  { value: "timesheets", label: "Timesheets", path: "/api/v1/reports/timesheets.csv" },
  { value: "vendor-spend", label: "Vendor Spend Summary", path: "/api/v1/reports/vendor-spend.csv" },
  { value: "model-usage", label: "Model Usage & Cost", path: "/api/v1/reports/model-usage.csv" },
  { value: "claim-outcomes", label: "Claim Outcomes", path: "/api/v1/reports/claim-outcomes.csv" },
  { value: "order-reconciliation", label: "Order Reconciliation", path: "/api/v1/reports/order-reconciliation.csv" },
  { value: "payroll-export", label: "Payroll Export", path: "/api/v1/reports/payroll-export.csv" },
] as const;

function formatMoney(value: number | string | null): string {
  return value === null ? "—" : `$${Number(value).toFixed(2)}`;
}

// 4 decimals, not 2 -- a single day's cost on a small model can genuinely
// be a fraction of a cent, and rounding that to $0.00 would make real spend
// invisible.
function formatCost(value: number | string): string {
  return `$${Number(value).toFixed(4)}`;
}

function VendorSpendSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<VendorSpendRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vendorSpendSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load vendor spend"));
  }, [dateFrom, dateTo]);

  const totalCost = rows.reduce((sum, r) => sum + Number(r.total_cost), 0);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Vendor spend summary</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Purchase order cost, grouped by vendor and month — who you're spending the most with, at a glance.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#888" }}>No purchase orders with a recorded cost in this range.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Month</th>
                <th style={thStyle}>POs</th>
                <th style={thStyle}>Total cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={tdStyle}>{r.vendor_name}</td>
                  <td style={tdStyle}>{new Date(r.month).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</td>
                  <td style={tdStyle}>{r.po_count}</td>
                  <td style={tdStyle}>{formatMoney(r.total_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }} colSpan={3}>
                  Total
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{formatMoney(totalCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelUsageSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<ModelUsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .modelUsageSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load model usage"));
  }, [dateFrom, dateTo]);

  const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const totalTokens = rows.reduce((sum, r) => sum + Number(r.total_tokens), 0);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Model usage &amp; cost</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Token usage and API cost, grouped by provider/model/month — aggregated nightly from real session
        transcripts, not an estimate.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#888" }}>No recorded usage in this range.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Provider</th>
                <th style={thStyle}>Model</th>
                <th style={thStyle}>Month</th>
                <th style={thStyle}>Total tokens</th>
                <th style={thStyle}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={tdStyle}>{r.provider}</td>
                  <td style={tdStyle}>{r.model}</td>
                  <td style={tdStyle}>{new Date(r.month).toLocaleDateString(undefined, { year: "numeric", month: "long" })}</td>
                  <td style={tdStyle}>{Number(r.total_tokens).toLocaleString()}</td>
                  <td style={tdStyle}>{formatCost(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }} colSpan={3}>
                  Total
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{totalTokens.toLocaleString()}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCost(totalCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function OrderReconciliationSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<OrderReconciliationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .orderReconciliationSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load order reconciliation"));
  }, [dateFrom, dateTo]);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Order reconciliation</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Requested vs. purchased quantity, per order item. Blank "Purchased" means no PO has been compiled for it yet
        (or it predates this tracking — older orders won't show a match here). Covers requested vs. purchased only,
        not what's physically on-site.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          Needed from <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#888" }}>No order items in this range.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Site</th>
                <th style={thStyle}>Item</th>
                <th style={thStyle}>Requested</th>
                <th style={thStyle}>Purchased</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>PO status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const mismatch = r.purchased_quantity !== null && Number(r.purchased_quantity) !== Number(r.requested_quantity);
                return (
                  <tr key={r.order_item_id}>
                    <td style={tdStyle}>{r.site_name ?? "—"}</td>
                    <td style={tdStyle}>{r.item_name ?? "—"}</td>
                    <td style={tdStyle}>{r.requested_quantity}</td>
                    <td style={{ ...tdStyle, color: mismatch ? "#c0392b" : undefined, fontWeight: mismatch ? 600 : undefined }}>
                      {r.purchased_quantity ?? "—"}
                    </td>
                    <td style={tdStyle}>{r.vendor_name ?? "—"}</td>
                    <td style={tdStyle}>{r.po_status ?? "not compiled"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Generic, not tied to any one payroll provider's template -- the business
// picks date_from/date_to to match whatever pay period their provider
// actually uses, then imports/maps this CSV's columns there. Only
// pay_type: 'payroll' crew appear -- cash-paid crew are paid outside the
// payroll system by definition.
function PayrollExportSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<PayrollExportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .payrollExportSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payroll export"));
  }, [dateFrom, dateTo]);

  const totalGross = rows.reduce((sum, r) => sum + (r.gross_pay ?? 0), 0);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Payroll export</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        A generic CSV for importing into any payroll provider — set the date range to match your actual pay period.
        Only payroll-paid crew appear here; cash-paid crew are handled outside the payroll system. Incomplete
        timeclock sessions are flagged, never guessed into hours.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          Pay period from <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#888" }}>No payroll-paid activity in this range.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Hours</th>
                <th style={thStyle}>Gross pay</th>
                <th style={thStyle}>Incomplete sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={tdStyle}>{r.crew_member_name}</td>
                  <td style={tdStyle}>{r.hourly_rate !== null ? formatMoney(r.hourly_rate) : "—"}</td>
                  <td style={tdStyle}>{r.hours_worked}</td>
                  <td style={tdStyle}>{r.gross_pay !== null ? formatMoney(r.gross_pay) : "—"}</td>
                  <td style={{ ...tdStyle, color: r.incomplete_sessions > 0 ? "#c0392b" : undefined }}>
                    {r.incomplete_sessions > 0 ? r.incomplete_sessions : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }} colSpan={3}>
                  Total
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{formatMoney(totalGross)}</td>
                <td style={tdStyle} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// Deliberately plain: counts only, no computed "score," no color-coded
// pass/fail, no ranking across crew members -- this is quiet data for
// management to notice patterns in if they want to, not an automated
// judgment. See docs/API.md's note on why this exists at all.
function ClaimOutcomesSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<ClaimOutcomeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .claimOutcomesSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined })
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load claim outcomes"));
  }, [dateFrom, dateTo]);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Claim outcomes</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        How spend and mileage claims have been decided, by crew member — approved, rejected, or disputed. Includes
        mileage claims rejected before ever reaching the spend ledger. Just counts, not a score.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#888" }}>No decided claims in this range.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Crew member</th>
                <th style={thStyle}>Approved</th>
                <th style={thStyle}>Rejected</th>
                <th style={thStyle}>Disputed</th>
                <th style={thStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.crew_member_id}>
                  <td style={tdStyle}>{r.crew_member_name}</td>
                  <td style={tdStyle}>{r.approved_count}</td>
                  <td style={tdStyle}>{r.rejected_count}</td>
                  <td style={tdStyle}>{r.disputed_count}</td>
                  <td style={tdStyle}>{r.total_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]["value"]>("jobs");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const ADMIN_ONLY_REPORT_TYPES = ["claim-outcomes", "payroll-export"];
  const visibleReportTypes = isAdmin
    ? REPORT_TYPES
    : REPORT_TYPES.filter((r) => !ADMIN_ONLY_REPORT_TYPES.includes(r.value));

  function download() {
    const report = REPORT_TYPES.find((r) => r.value === reportType)!;
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const qs = params.toString();
    window.location.href = `${report.path}${qs ? `?${qs}` : ""}`;
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Reports</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          CSV exports of history that already tracks who did what, including computed timesheet sessions. Pay rates,
          correction workflows, and pay periods aren't handled here yet.
        </p>

        <div style={filterBarStyle}>
          <select value={reportType} onChange={(e) => setReportType(e.target.value as typeof reportType)}>
            {visibleReportTypes.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 13 }}>
            From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: 13 }}>
            To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <button onClick={download}>Download CSV</button>
        </div>
      </section>

      <VendorSpendSection />
      <ModelUsageSection />
      <OrderReconciliationSection />
      {isAdmin && <PayrollExportSection />}
      {isAdmin && <ClaimOutcomesSection />}
    </div>
  );
}
