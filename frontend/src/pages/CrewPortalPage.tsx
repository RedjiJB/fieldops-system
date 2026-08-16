import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import { useAuth } from "../context/AuthContext";
import {
  api,
  type MyPay,
  type MyShifts,
  type MyCheckout,
  type MySpendRecord,
  type MySiteRosterEntry,
  type MySiteCheckout,
  type MySiteOrder,
} from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { SkeletonRows } from "../components/Skeleton";

// Deliberately not a cut-down version of the 17-tab admin Dashboard --
// crew are on their phones mid-job, not at a desk. One page, four short
// sections, no nav complexity. Every /me/* call is scoped server-side to
// whoever's session this is -- there is no id to pick here, unlike every
// other page in this app.
//
// Foreman/management/owner-role crew sessions get three more sections
// (site roster, site checkouts, site orders) -- but not identically scoped
// data. foreman is "a little more": their own site(s) only. management/
// owner is "even more": every active site, org-wide -- see
// backend/src/routes/me.ts's resolveVisibleSiteIds for where that split
// actually happens; this frontend set only controls which sessions see the
// three extra sections at all, not how much data lands in them. Still one
// page, not a second admin-style surface -- the extra sections just render
// below the base four when they apply.
const FOREMAN_TIER_ROLES = new Set(["foreman", "management", "owner"]);

const rowStyle = { display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 };
const labelStyle = { color: "var(--color-text-muted)", fontSize: 13 };

function formatMoney(amount: number | null): string {
  if (amount === null) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

function formatHours(netSeconds: number | null): string {
  if (netSeconds === null) return "—";
  return (Number(netSeconds) / 3600).toFixed(2);
}

function spendStatusTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "rejected" || status === "disputed") return "bad";
  if (status === "pending") return "warn";
  return "good";
}

function orderStatusTone(status: string): "good" | "warn" | "neutral" {
  if (status === "requested") return "neutral";
  if (status === "returned") return "good";
  return "warn";
}

export function CrewPortalPage() {
  const { user, logout } = useAuth();
  const isForemanTier = user?.identityType === "crew" && FOREMAN_TIER_ROLES.has(user.role);

  const [pay, setPay] = useState<MyPay | null>(null);
  const [shifts, setShifts] = useState<MyShifts | null>(null);
  const [checkouts, setCheckouts] = useState<MyCheckout[]>([]);
  const [spendRecords, setSpendRecords] = useState<MySpendRecord[]>([]);
  const [siteRoster, setSiteRoster] = useState<MySiteRosterEntry[] | null>(null);
  const [siteCheckouts, setSiteCheckouts] = useState<MySiteCheckout[] | null>(null);
  const [siteOrders, setSiteOrders] = useState<MySiteOrder[] | null>(null);
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

  useEffect(() => {
    if (!isForemanTier) return;
    Promise.all([api.mySiteRoster(), api.mySiteCheckouts(), api.mySiteOrders()])
      .then(([roster, siteC, orders]) => {
        setSiteRoster(roster);
        setSiteCheckouts(siteC);
        setSiteOrders(orders);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load site data"));
  }, [isForemanTier]);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "var(--color-bg)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 16px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={logo} alt="Sod Boys Ltd" className="brand-logo" style={{ height: 28 }} />
          <span style={{ fontSize: 15, fontWeight: 700 }}>{user?.name}</span>
        </span>
        <button onClick={() => logout()}>Log out</button>
      </div>
      {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, padding: "12px 16px 0" }}>{error}</div>}

      <section className="card">
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
          <SkeletonRows count={3} />
        )}
      </section>

      <section className="card">
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
                <StatusBadge label={sh.status} tone="neutral" />
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
          <SkeletonRows count={3} />
        )}
      </section>

      <section className="card">
        <h3 style={{ fontSize: 14 }}>Checked out to you</h3>
        {checkouts.length === 0 && <p style={labelStyle}>Nothing currently checked out to you.</p>}
        {checkouts.map((c) => (
          <div key={c.id} style={rowStyle}>
            <span>{c.asset_name}</span>
            <StatusBadge label={c.checked_in_at ? "returned" : "with you"} tone={c.checked_in_at ? "good" : "neutral"} />
          </div>
        ))}
      </section>

      <section className="card">
        <h3 style={{ fontSize: 14 }}>Your claims</h3>
        {spendRecords.length === 0 && <p style={labelStyle}>No spend or mileage claims submitted.</p>}
        {spendRecords.map((sr) => (
          <div key={sr.id} style={rowStyle}>
            <span>
              {sr.category} — {new Date(sr.occurred_at).toLocaleDateString()}
              {sr.status === "rejected" && sr.rejection_note && (
                <div style={labelStyle}>Reason: {sr.rejection_note}</div>
              )}
              {sr.dispute_note && <div style={labelStyle}>Disputed: {sr.dispute_note}</div>}
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <StatusBadge label={sr.status} tone={spendStatusTone(sr.status)} />
              {sr.amount !== null && <span style={labelStyle}>{formatMoney(sr.amount)}</span>}
            </span>
          </div>
        ))}
      </section>

      {isForemanTier && (
        <>
          <section className="card">
            <h3 style={{ fontSize: 14 }}>Site roster — today</h3>
            {siteRoster === null ? (
              <SkeletonRows count={3} />
            ) : siteRoster.length === 0 ? (
              <p style={labelStyle}>No confirmed shift today — nothing to show.</p>
            ) : (
              siteRoster.map((r) => (
                <div key={r.crew_member_id} style={rowStyle}>
                  <span>
                    {r.name} — {r.site_name}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <StatusBadge label={r.last_event_type ?? "no clock-in yet"} tone={r.last_event_type ? "good" : "neutral"} />
                    {r.last_event_at && <span style={labelStyle}>{new Date(r.last_event_at).toLocaleTimeString()}</span>}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14 }}>Checked out at your site</h3>
            {siteCheckouts === null ? (
              <SkeletonRows count={3} />
            ) : siteCheckouts.length === 0 ? (
              <p style={labelStyle}>Nothing currently checked out at your site.</p>
            ) : (
              siteCheckouts.map((c) => (
                <div key={c.id} style={rowStyle}>
                  <span>{c.asset_name}</span>
                  <span style={labelStyle}>{c.checked_out_by_name}</span>
                </div>
              ))
            )}
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14 }}>Site orders</h3>
            {siteOrders === null ? (
              <SkeletonRows count={3} />
            ) : siteOrders.length === 0 ? (
              <p style={labelStyle}>No orders for your site.</p>
            ) : (
              siteOrders.map((o) => (
                <div key={o.id} style={rowStyle}>
                  <span>
                    {new Date(o.created_at).toLocaleDateString()} — {o.requester_name}
                    {o.items.length > 0 ? ` (${o.items.length} item${o.items.length === 1 ? "" : "s"})` : ""}
                  </span>
                  <StatusBadge label={o.status} tone={orderStatusTone(o.status)} />
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
