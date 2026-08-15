import { useEffect, useState } from "react";
import { api, PAY_TYPES, type PayProfile, type Payout, type ReconciliationRow } from "../api/client";
import { useAuth } from "../context/AuthContext";

const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};

function formatMoney(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function PayProfileRow({ profile, onSaved }: { profile: PayProfile; onSaved: (p: PayProfile) => void }) {
  const [payType, setPayType] = useState(profile.pay_type);
  const [hourlyRate, setHourlyRate] = useState(profile.hourly_rate === null ? "" : String(profile.hourly_rate));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const rate = hourlyRate.trim() === "" ? undefined : Number(hourlyRate);
      if (rate !== undefined && (Number.isNaN(rate) || rate < 0)) {
        setError("Hourly rate must be a non-negative number");
        return;
      }
      const updated = await api.updatePayProfile(profile.crew_member_id, { pay_type: payType, hourly_rate: rate });
      onSaved({ ...profile, ...updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={rowStyle}>
      <strong>{profile.crew_member_name}</strong>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select value={payType} onChange={(e) => setPayType(e.target.value as PayProfile["pay_type"])}>
          {PAY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="hourly rate"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          style={{ width: 100 }}
        />
        <button className="btn-primary" onClick={save} disabled={saving}>
          Save
        </button>
        {error && <span style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</span>}
      </span>
    </div>
  );
}

function NewPayoutForm({
  profiles,
  onCreated,
}: {
  profiles: PayProfile[];
  onCreated: (p: Payout) => void;
}) {
  const [crewMemberId, setCrewMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountNum = Number(amount);
    if (!crewMemberId || !amount || Number.isNaN(amountNum) || amountNum <= 0) {
      setError("Crew member and a positive amount are required");
      return;
    }
    try {
      const created = await api.createPayout({
        crew_member_id: crewMemberId,
        amount: amountNum,
        note: note || undefined,
        paid_at: paidAt ? new Date(paidAt).toISOString() : undefined,
      });
      onCreated(created);
      setCrewMemberId("");
      setAmount("");
      setNote("");
      setPaidAt("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payout");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
      <select value={crewMemberId} onChange={(e) => setCrewMemberId(e.target.value)}>
        <option value="">Crew member…</option>
        {profiles.map((p) => (
          <option key={p.crew_member_id} value={p.crew_member_id}>
            {p.crew_member_name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0.01"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ width: 100 }}
      />
      <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <label style={{ fontSize: 13 }}>
        Paid at (optional, defaults to now)
        <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </label>
      <button className="btn-primary" onClick={submit}>+ Record payout</button>
      {error && <span style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

export function PayrollPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [profiles, setProfiles] = useState<PayProfile[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutCrewFilter, setPayoutCrewFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [reconCrewFilter, setReconCrewFilter] = useState("");
  const [reconDateFrom, setReconDateFrom] = useState("");
  const [reconDateTo, setReconDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reloadProfiles() {
    api.payProfiles().then(setProfiles).catch((err) => setError(err instanceof Error ? err.message : "Failed to load pay profiles"));
  }

  function reloadPayouts() {
    api
      .payouts({
        crew_member_id: payoutCrewFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      .then(setPayouts)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payouts"));
  }

  function reloadReconciliation() {
    api
      .payrollReconciliation({
        crew_member_id: reconCrewFilter || undefined,
        date_from: reconDateFrom || undefined,
        date_to: reconDateTo || undefined,
      })
      .then(setReconciliation)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reconciliation"));
  }

  useEffect(() => {
    if (isAdmin) reloadProfiles();
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) reloadPayouts();
  }, [isAdmin, payoutCrewFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (isAdmin) reloadReconciliation();
  }, [isAdmin, reconCrewFilter, reconDateFrom, reconDateTo]);

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section className="card">
          <h2>Payroll</h2>
          <p style={{ color: "var(--color-text-muted)" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section className="card">
        <h2>Pay profiles</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          What each crew member is paid — payroll (hourly, reconciled by payroll's own system) or cash (often a lump
          sum payout at end of day, logged below rather than reconciled to precise hour math in real time). Wage
          data, admin-only.
        </p>
        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        {profiles.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No crew members on file.</p>}
        {profiles.map((p) => (
          <PayProfileRow
            key={p.crew_member_id}
            profile={p}
            onSaved={(updated) => setProfiles((prev) => prev.map((x) => (x.crew_member_id === updated.crew_member_id ? updated : x)))}
          />
        ))}
      </section>

      <section className="card">
        <h2>Payouts</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          A record that an amount was actually paid out — independent of computed hours. See Reconciliation below for
          how this compares against computed timesheet hours.
        </p>

        <NewPayoutForm profiles={profiles} onCreated={(p) => setPayouts((prev) => [p, ...prev])} />

        <div style={filterBarStyle}>
          <select value={payoutCrewFilter} onChange={(e) => setPayoutCrewFilter(e.target.value)}>
            <option value="">All crew</option>
            {profiles.map((p) => (
              <option key={p.crew_member_id} value={p.crew_member_id}>
                {p.crew_member_name}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 13 }}>
            From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: 13 }}>
            To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>

        {payouts.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No payouts match these filters.</p>}
        {payouts.map((p) => (
          <div key={p.id} style={rowStyle}>
            <span>
              <strong>{p.crew_member_name}</strong>
              <span style={{ color: "var(--color-text-muted)" }}>
                {" "}
                — ${Number(p.amount).toFixed(2)} — {new Date(p.paid_at).toLocaleString()}
                {p.note ? ` — ${p.note}` : ""} — recorded by {p.recorded_by_name}
              </span>
            </span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Reconciliation</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Computed hours × hourly rate, against what's actually been paid out. "No rate set" means owed can't be
          computed — never shown as $0. Sessions with no clock-out are counted separately and excluded from hours,
          never treated as complete.
        </p>

        <div style={filterBarStyle}>
          <select value={reconCrewFilter} onChange={(e) => setReconCrewFilter(e.target.value)}>
            <option value="">All crew</option>
            {profiles.map((p) => (
              <option key={p.crew_member_id} value={p.crew_member_id}>
                {p.crew_member_name}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 13 }}>
            From <input type="date" value={reconDateFrom} onChange={(e) => setReconDateFrom(e.target.value)} />
          </label>
          <label style={{ fontSize: 13 }}>
            To <input type="date" value={reconDateTo} onChange={(e) => setReconDateTo(e.target.value)} />
          </label>
        </div>

        {reconciliation.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>No activity matches these filters.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Crew member</th>
                  <th>Pay type</th>
                  <th>Hours</th>
                  <th>Incomplete sessions</th>
                  <th>Owed</th>
                  <th>Paid</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.map((r) => (
                  <tr key={r.crew_member_id}>
                    <td>{r.crew_member_name}</td>
                    <td>{r.pay_type}</td>
                    <td>{r.completed_hours.toFixed(2)}</td>
                    <td style={r.incomplete_sessions > 0 ? { color: "var(--color-status-warn)", fontWeight: 600 } : undefined}>
                      {r.incomplete_sessions > 0 ? r.incomplete_sessions : "—"}
                    </td>
                    <td>{r.hourly_rate === null ? "no rate set" : formatMoney(r.amount_owed)}</td>
                    <td>{formatMoney(r.amount_paid)}</td>
                    <td style={r.difference !== null && r.difference !== 0 ? { color: "var(--color-status-bad)", fontWeight: 600 } : undefined}>
                      {r.difference === null ? "—" : formatMoney(r.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
