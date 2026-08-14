import { useEffect, useState } from "react";
import { api, type PeriodCloseSummary, type SpendRecord } from "../api/client";
import { useAuth } from "../context/AuthContext";

const sectionStyle = { padding: 16 };
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const thStyle = { textAlign: "left" as const, padding: "6px 10px", fontSize: 13, color: "#888", borderBottom: "1px solid #ddd" };
const tdStyle = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #f0f0f0" };
const cardStyle = { padding: 12, border: "1px solid #ddd", borderRadius: 4, minWidth: 140 };
const cardLabelStyle = { fontSize: 12, color: "#888" };
const cardValueStyle = { fontSize: 20, fontWeight: 600 };

function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

function MissingReceiptsSection() {
  const [records, setRecords] = useState<SpendRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .missingReceipts()
      .then(setRecords)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load missing receipts"));
  }, []);

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Missing receipts</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Approved spend with no receipt attached — a year-end/tax-prep check, not an urgent alert. Mileage claims are
        excluded (rate-computed, not receipt-based, so they structurally can't have one).
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      {records.length === 0 ? (
        <p style={{ color: "#888" }}>No approved spend is missing a receipt.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Crew member</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Description</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{new Date(r.occurred_at).toLocaleDateString()}</td>
                  <td style={tdStyle}>{r.crew_member_name ?? "—"}</td>
                  <td style={tdStyle}>{r.category}</td>
                  <td style={tdStyle}>{r.method}</td>
                  <td style={tdStyle}>{formatMoney(r.amount)}</td>
                  <td style={tdStyle}>{r.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PeriodCloseSection() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [summary, setSummary] = useState<PeriodCloseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dateFrom || !dateTo) {
      setSummary(null);
      return;
    }
    api
      .periodCloseSummary(dateFrom, dateTo)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load period-close summary"));
  }, [dateFrom, dateTo]);

  function downloadCsv() {
    window.location.href = `/api/v1/reports/period-close.csv?date_from=${dateFrom}&date_to=${dateTo}`;
  }

  const totalSpend = summary ? summary.spend.reduce((sum, r) => sum + Number(r.total_amount), 0) : 0;

  return (
    <section style={sectionStyle}>
      <h2 style={{ fontSize: 16 }}>Period-close summary</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        One rollup — completed jobs, hours, spend, missing receipts, and anomalies — for handing to a
        bookkeeper/accountant at month or quarter close.
      </p>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={filterBarStyle}>
        <label style={{ fontSize: 13 }}>
          From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 13 }}>
          To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button onClick={downloadCsv} disabled={!dateFrom || !dateTo}>
          Download CSV
        </button>
      </div>

      {!dateFrom || !dateTo ? (
        <p style={{ color: "#888" }}>Pick both a start and end date to see a rollup.</p>
      ) : !summary ? (
        <p style={{ color: "#888" }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" as const }}>
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Completed jobs</div>
              <div style={cardValueStyle}>{summary.jobs.length}</div>
            </div>
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Total spend</div>
              <div style={cardValueStyle}>{formatMoney(totalSpend)}</div>
            </div>
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Missing receipts</div>
              <div style={cardValueStyle}>{summary.missing_receipts.count}</div>
            </div>
            <div style={cardStyle}>
              <div style={cardLabelStyle}>Anomalies</div>
              <div style={cardValueStyle}>{summary.anomalies.alerts.length}</div>
            </div>
          </div>

          <h3 style={{ fontSize: 14 }}>Completed jobs</h3>
          {summary.jobs.length === 0 ? (
            <p style={{ color: "#888" }}>None in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Site</th>
                    <th style={thStyle}>Job type</th>
                    <th style={thStyle}>Completed at</th>
                    <th style={thStyle}>Completed by</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.jobs.map((j) => (
                    <tr key={j.id}>
                      <td style={tdStyle}>{j.site_name ?? "—"}</td>
                      <td style={tdStyle}>{j.job_type_name ?? "—"}</td>
                      <td style={tdStyle}>{new Date(j.completed_at).toLocaleString()}</td>
                      <td style={tdStyle}>{j.completed_by_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14 }}>Hours by crew member</h3>
          {summary.hours.length === 0 ? (
            <p style={{ color: "#888" }}>No timeclock activity in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Crew member</th>
                    <th style={thStyle}>Hours</th>
                    <th style={thStyle}>Incomplete sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.hours.map((h) => (
                    <tr key={h.crew_member_id}>
                      <td style={tdStyle}>{h.crew_member_name}</td>
                      <td style={tdStyle}>{h.completed_hours.toFixed(2)}</td>
                      <td style={{ ...tdStyle, color: h.incomplete_sessions > 0 ? "#c9902f" : undefined }}>
                        {h.incomplete_sessions > 0 ? h.incomplete_sessions : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14 }}>Spend by category</h3>
          {summary.spend.length === 0 ? (
            <p style={{ color: "#888" }}>No approved spend in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Category</th>
                    <th style={thStyle}>Count</th>
                    <th style={thStyle}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.spend.map((s) => (
                    <tr key={s.category}>
                      <td style={tdStyle}>{s.category}</td>
                      <td style={tdStyle}>{s.count}</td>
                      <td style={tdStyle}>{formatMoney(s.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14 }}>Anomalies</h3>
          {summary.anomalies.alerts.length === 0 ? (
            <p style={{ color: "#888" }}>No alerts raised in this period.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Site</th>
                    <th style={thStyle}>Raised at</th>
                    <th style={thStyle}>Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.anomalies.alerts.map((a) => (
                    <tr key={a.id}>
                      <td style={tdStyle}>{a.type}</td>
                      <td style={tdStyle}>{a.site_name ?? "—"}</td>
                      <td style={tdStyle}>{new Date(a.raised_at).toLocaleString()}</td>
                      <td style={tdStyle}>{a.resolved_at ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function CompliancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 16 }}>Compliance</h2>
          <p style={{ color: "#888" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <MissingReceiptsSection />
      <PeriodCloseSection />
    </div>
  );
}
