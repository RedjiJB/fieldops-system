import { useEffect, useState } from "react";
import { api, type VendorSpendRow, type ModelUsageRow } from "../api/client";

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

export function ReportsPage() {
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]["value"]>("jobs");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
            {REPORT_TYPES.map((r) => (
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
    </div>
  );
}
