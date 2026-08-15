import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type CrewMember, type TimeclockSession } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";

const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const, alignItems: "center" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};

function formatHours(netSeconds: number | null): string {
  if (netSeconds === null) return "—";
  return (netSeconds / 3600).toFixed(2);
}

function formatBreak(breakSeconds: number): string {
  return `${Math.round(breakSeconds / 60)} min`;
}

export function TimesheetsPage() {
  const [sessions, setSessions] = useState<TimeclockSession[]>([]);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [crewMemberId, setCrewMemberId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.crewMembers().then(setCrewMembers).catch(() => {});
  }, []);

  function reload() {
    api
      .timeclockSessions({
        crew_member_id: crewMemberId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load timesheets"));
  }

  useEffect(reload, [crewMemberId, dateFrom, dateTo]);

  const nameById = useMemo(() => new Map(crewMembers.map((c) => [c.id, c.name])), [crewMembers]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimeclockSession[]>();
    for (const s of sessions) {
      const list = map.get(s.crew_member_id) ?? [];
      list.push(s);
      map.set(s.crew_member_id, list);
    }
    return [...map.entries()];
  }, [sessions]);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section className="card">
        <h2>Timesheets</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Clock-in/out sessions computed from raw timeclock events. A session with no matching clock-out is flagged
          "incomplete" rather than guessed. Overtime/missed-break flags use the thresholds set on the Notification
          Settings page — pay rates, corrections, and pay periods aren't handled here.
        </p>
        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={filterBarStyle}>
          <select value={crewMemberId} onChange={(e) => setCrewMemberId(e.target.value)}>
            <option value="">All crew</option>
            {crewMembers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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

        {grouped.length === 0 && <EmptyState icon={Clock} title="No sessions match these filters" description="Clock-ins are recorded over WhatsApp and show up here." />}
        {grouped.map(([crewId, crewSessions]) => (
          <div key={crewId} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>{nameById.get(crewId) ?? crewId}</h3>
            {crewSessions.map((s, idx) => (
              <div key={idx} style={rowStyle}>
                <span>
                  {new Date(s.started_at).toLocaleString()} →{" "}
                  {s.ended_at ? new Date(s.ended_at).toLocaleString() : "no clock-out"}
                  <span style={{ color: "var(--color-text-muted)" }}> — break {formatBreak(s.break_seconds)}</span>
                  {!s.geofence_verified && (
                    <>
                      {" "}
                      <StatusBadge label="geofence unverified" tone="warn" />
                    </>
                  )}
                  {s.overtime && (
                    <>
                      {" "}
                      <StatusBadge label="overtime" tone="bad" />
                    </>
                  )}
                  {s.missed_break && (
                    <>
                      {" "}
                      <StatusBadge label="missed break" tone="warn" />
                    </>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {s.incomplete ? (
                    <span style={{ color: "var(--color-status-bad)", fontSize: 13, fontWeight: "bold" }}>incomplete</span>
                  ) : (
                    <span>{formatHours(s.net_seconds)} h</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
