import { useEffect, useState } from "react";
import { api, type PeriodCloseSummary, type SpendRecord } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";

const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };

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
    <section className="card">
      <h2>Missing receipts</h2>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        Approved spend with no receipt attached — a year-end/tax-prep check, not an urgent alert. Mileage claims are
        excluded (rate-computed, not receipt-based, so they structurally can't have one).
      </p>
      {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

      {records.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No approved spend is missing a receipt.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Crew member</th>
                <th>Category</th>
                <th>Method</th>
                <th>Amount</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.occurred_at).toLocaleDateString()}</td>
                  <td>{r.crew_member_name ?? "—"}</td>
                  <td>{r.category}</td>
                  <td>{r.method}</td>
                  <td>{formatMoney(r.amount)}</td>
                  <td>{r.description ?? "—"}</td>
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
    <section className="card">
      <h2>Period-close summary</h2>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        One rollup — completed jobs, hours, spend, missing receipts, and anomalies — for handing to a
        bookkeeper/accountant at month or quarter close.
      </p>
      {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

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
        <p style={{ color: "var(--color-text-muted)" }}>Pick both a start and end date to see a rollup.</p>
      ) : !summary ? (
        <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" as const }}>
            <div className="kpi-card">
              <div className="kpi-card-label">Completed jobs</div>
              <div className="kpi-card-value">{summary.jobs.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Total spend</div>
              <div className="kpi-card-value">{formatMoney(totalSpend)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Missing receipts</div>
              <div className="kpi-card-value">{summary.missing_receipts.count}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card-label">Anomalies</div>
              <div className="kpi-card-value">{summary.anomalies.alerts.length}</div>
            </div>
          </div>

          <h3 style={{ fontSize: 14 }}>Completed jobs</h3>
          {summary.jobs.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>None in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th>Job type</th>
                    <th>Completed at</th>
                    <th>Completed by</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.jobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.site_name ?? "—"}</td>
                      <td>{j.job_type_name ?? "—"}</td>
                      <td>{new Date(j.completed_at).toLocaleString()}</td>
                      <td>{j.completed_by_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14 }}>Hours by crew member</h3>
          {summary.hours.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>No timeclock activity in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Crew member</th>
                    <th>Hours</th>
                    <th>Incomplete sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.hours.map((h) => (
                    <tr key={h.crew_member_id}>
                      <td>{h.crew_member_name}</td>
                      <td>{h.completed_hours.toFixed(2)}</td>
                      <td style={h.incomplete_sessions > 0 ? { color: "var(--color-status-warn)", fontWeight: 600 } : undefined}>
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
            <p style={{ color: "var(--color-text-muted)" }}>No approved spend in this period.</p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Count</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.spend.map((s) => (
                    <tr key={s.category}>
                      <td>{s.category}</td>
                      <td>{s.count}</td>
                      <td>{formatMoney(s.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: 14 }}>Anomalies</h3>
          {summary.anomalies.alerts.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>No alerts raised in this period.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Site</th>
                    <th>Raised at</th>
                    <th>Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.anomalies.alerts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.type}</td>
                      <td>{a.site_name ?? "—"}</td>
                      <td>{new Date(a.raised_at).toLocaleString()}</td>
                      <td>
                        <StatusBadge label={a.resolved_at ? "resolved" : "unresolved"} tone={a.resolved_at ? "good" : "bad"} />
                      </td>
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
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section className="card">
          <h2>Compliance</h2>
          <p style={{ color: "var(--color-text-muted)" }}>Admin access required.</p>
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
