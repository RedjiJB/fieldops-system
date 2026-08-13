import { useState } from "react";

const sectionStyle = { padding: 16 };
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };

const REPORT_TYPES = [
  { value: "jobs", label: "Jobs", path: "/api/v1/reports/jobs.csv" },
  { value: "checkouts", label: "Checkouts", path: "/api/v1/reports/checkouts.csv" },
  { value: "purchase-orders", label: "Purchase Orders", path: "/api/v1/reports/purchase-orders.csv" },
] as const;

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
          CSV exports of history that already tracks who did what. Hours/payroll summaries aren't built yet — the
          underlying timeclock data only stores individual clock events, not paired shifts.
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
    </div>
  );
}
