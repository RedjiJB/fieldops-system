import { useEffect, useState } from "react";
import { api, PAY_TYPES, type PayProfile, type Payout, type ReconciliationRow } from "../api/client";
import { useAuth } from "../context/AuthContext";

const sectionStyle = { padding: 16 };
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};
const thStyle = { textAlign: "left" as const, padding: "6px 10px", fontSize: 13, color: "#888", borderBottom: "1px solid #ddd" };
const tdStyle = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #f0f0f0" };

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
        <button onClick={save} disabled={saving}>
          Save
        </button>
        {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
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
      <button onClick={submit}>+ Record payout</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
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
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 16 }}>Payroll</h2>
          <p style={{ color: "#888" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Pay profiles</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          What each crew member is paid — payroll (hourly, reconciled by payroll's own system) or cash (often a lump
          sum payout at end of day, logged below rather than reconciled to precise hour math in real time). Wage
          data, admin-only.
        </p>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        {profiles.length === 0 && <p style={{ color: "#888" }}>No crew members on file.</p>}
        {profiles.map((p) => (
          <PayProfileRow
            key={p.crew_member_id}
            profile={p}
            onSaved={(updated) => setProfiles((prev) => prev.map((x) => (x.crew_member_id === updated.crew_member_id ? updated : x)))}
          />
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Payouts</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
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

        {payouts.length === 0 && <p style={{ color: "#888" }}>No payouts match these filters.</p>}
        {payouts.map((p) => (
          <div key={p.id} style={rowStyle}>
            <span>
              <strong>{p.crew_member_name}</strong>
              <span style={{ color: "#888" }}>
                {" "}
                — ${Number(p.amount).toFixed(2)} — {new Date(p.paid_at).toLocaleString()}
                {p.note ? ` — ${p.note}` : ""} — recorded by {p.recorded_by_name}
              </span>
            </span>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Reconciliation</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
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
          <p style={{ color: "#888" }}>No activity matches these filters.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Crew member</th>
                  <th style={thStyle}>Pay type</th>
                  <th style={thStyle}>Hours</th>
                  <th style={thStyle}>Incomplete sessions</th>
                  <th style={thStyle}>Owed</th>
                  <th style={thStyle}>Paid</th>
                  <th style={thStyle}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.map((r) => (
                  <tr key={r.crew_member_id}>
                    <td style={tdStyle}>{r.crew_member_name}</td>
                    <td style={tdStyle}>{r.pay_type}</td>
                    <td style={tdStyle}>{r.completed_hours.toFixed(2)}</td>
                    <td style={{ ...tdStyle, color: r.incomplete_sessions > 0 ? "#c9902f" : undefined }}>
                      {r.incomplete_sessions > 0 ? r.incomplete_sessions : "—"}
                    </td>
                    <td style={tdStyle}>{r.hourly_rate === null ? "no rate set" : formatMoney(r.amount_owed)}</td>
                    <td style={tdStyle}>{formatMoney(r.amount_paid)}</td>
                    <td style={{ ...tdStyle, color: r.difference !== null && r.difference !== 0 ? "#c0392b" : undefined }}>
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
