import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, type MyPay, type MyShifts, type MyCheckout, type MySpendRecord } from "../api/client";

// Deliberately not a cut-down version of the 17-tab admin Dashboard --
// crew are on their phones mid-job, not at a desk. One page, four short
// sections, no nav complexity. Every /me/* call is scoped server-side to
// whoever's session this is -- there is no id to pick here, unlike every
// other page in this app.

const sectionStyle = { padding: 16, borderBottom: "1px solid #eee" };
const rowStyle = { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 };
const labelStyle = { color: "#888", fontSize: 13 };

function formatMoney(amount: number | null): string {
  if (amount === null) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

function formatHours(netSeconds: number | null): string {
  if (netSeconds === null) return "—";
  return (Number(netSeconds) / 3600).toFixed(2);
}

export function CrewPortalPage() {
  const { user, logout } = useAuth();
  const [pay, setPay] = useState<MyPay | null>(null);
  const [shifts, setShifts] = useState<MyShifts | null>(null);
  const [checkouts, setCheckouts] = useState<MyCheckout[]>([]);
  const [spendRecords, setSpendRecords] = useState<MySpendRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.myPay(), api.myShifts(), api.myCheckouts(), api.mySpendRecords()])
      .then(([p, s, c, sr]) => {
        setPay(p);
        setShifts(s);
        setCheckouts(c);
        setSpendRecords(sr);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your dashboard"));
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{user?.name}</h2>
        <button onClick={() => logout()}>Log out</button>
      </div>
      {error && <div style={{ color: "#c0392b", fontSize: 13, padding: "0 16px" }}>{error}</div>}

      <section style={sectionStyle}>
        <h3 style={{ fontSize: 14 }}>Pay</h3>
        {pay ? (
          <>
            <div style={rowStyle}>
              <span style={labelStyle}>Pay type</span>
              <span>{pay.profile.pay_type}</span>
            </div>
            {pay.profile.pay_type === "payroll" && (
              <div style={rowStyle}>
                <span style={labelStyle}>Hourly rate</span>
                <span>{pay.profile.hourly_rate === null ? "not set" : formatMoney(pay.profile.hourly_rate)}</span>
              </div>
            )}
            <h4 style={{ fontSize: 13, marginTop: 12, marginBottom: 4 }}>Recent payouts</h4>
            {pay.payouts.length === 0 && <p style={labelStyle}>No payouts recorded yet.</p>}
            {pay.payouts.map((p) => (
              <div key={p.id} style={rowStyle}>
                <span>{new Date(p.paid_at).toLocaleDateString()}</span>
                <span>{formatMoney(p.amount)}</span>
              </div>
            ))}
          </>
        ) : (
          <p style={labelStyle}>Loading…</p>
        )}
      </section>

      <section style={sectionStyle}>
        <h3 style={{ fontSize: 14 }}>Shifts &amp; timesheet</h3>
        {shifts ? (
          <>
            <h4 style={{ fontSize: 13, marginBottom: 4 }}>Upcoming/recent shifts</h4>
            {shifts.shifts.length === 0 && <p style={labelStyle}>No shifts on file.</p>}
            {shifts.shifts.slice(0, 10).map((sh) => (
              <div key={sh.id} style={rowStyle}>
                <span>
                  {new Date(sh.date).toLocaleDateString()} — {sh.site_name ?? "no site"}
                </span>
                <span style={labelStyle}>{sh.status}</span>
              </div>
            ))}
            <h4 style={{ fontSize: 13, marginTop: 12, marginBottom: 4 }}>Recent hours</h4>
            {shifts.timeclock_sessions.length === 0 && <p style={labelStyle}>No clock-in history yet.</p>}
            {shifts.timeclock_sessions.slice(0, 10).map((s, idx) => (
              <div key={idx} style={rowStyle}>
                <span>{new Date(s.started_at).toLocaleDateString()}</span>
                <span>{s.incomplete ? "incomplete" : `${formatHours(s.net_seconds)} h`}</span>
              </div>
            ))}
          </>
        ) : (
          <p style={labelStyle}>Loading…</p>
        )}
      </section>

      <section style={sectionStyle}>
        <h3 style={{ fontSize: 14 }}>Checked out to you</h3>
        {checkouts.length === 0 && <p style={labelStyle}>Nothing currently checked out to you.</p>}
        {checkouts.map((c) => (
          <div key={c.id} style={rowStyle}>
            <span>{c.asset_name}</span>
            <span style={labelStyle}>{c.checked_in_at ? "returned" : "with you"}</span>
          </div>
        ))}
      </section>

      <section style={sectionStyle}>
        <h3 style={{ fontSize: 14 }}>Your claims</h3>
        {spendRecords.length === 0 && <p style={labelStyle}>No spend or mileage claims submitted.</p>}
        {spendRecords.map((sr) => (
          <div key={sr.id} style={rowStyle}>
            <span>
              {sr.category} — {new Date(sr.occurred_at).toLocaleDateString()}
            </span>
            <span style={labelStyle}>
              {sr.status}
              {sr.amount !== null ? ` · ${formatMoney(sr.amount)}` : ""}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
