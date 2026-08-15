import { useEffect, useState } from "react";
import { api, SITE_TYPES, type Site } from "../api/client";

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const };
const editGridStyle = { display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center" };

type Draft = {
  name: string;
  type: Site["type"];
  address: string;
  access_instructions: string;
  access_hours: string;
  center_lat: string;
  center_lng: string;
  geofence_radius_m: string;
  active_start: string;
  active_end: string;
};

function toDraft(s: Site): Draft {
  return {
    name: s.name,
    type: s.type,
    address: s.address ?? "",
    access_instructions: s.access_instructions ?? "",
    access_hours: s.access_hours ?? "",
    center_lat: s.center_lat != null ? String(s.center_lat) : "",
    center_lng: s.center_lng != null ? String(s.center_lng) : "",
    geofence_radius_m: s.geofence_radius_m != null ? String(s.geofence_radius_m) : "",
    active_start: s.active_start ?? "",
    active_end: s.active_end ?? "",
  };
}

export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .sites({ type: type || undefined })
      .then(setSites)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load sites"));
  }

  useEffect(reload, [type]);

  const visibleSites = search.trim()
    ? sites.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sites;

  function startEdit(site: Site) {
    setEditingId(site.id);
    setDraft(toDraft(site));
  }

  async function saveEdit(site: Site) {
    if (!draft) return;
    try {
      const updated = await api.updateSite(site.id, {
        name: draft.name,
        type: draft.type,
        address: draft.address || null,
        access_instructions: draft.access_instructions || null,
        access_hours: draft.access_hours || null,
        center_lat: draft.center_lat ? Number(draft.center_lat) : null,
        center_lng: draft.center_lng ? Number(draft.center_lng) : null,
        geofence_radius_m: draft.geofence_radius_m ? Number(draft.geofence_radius_m) : null,
        active_start: draft.active_start || null,
        active_end: draft.active_end || null,
      });
      setSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, ...updated } : s)));
      setEditingId(null);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update site");
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "var(--color-status-bad)" }}>{error}</div>}

      <section className="card">
        <h2>Sites</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Polygon geofences aren't editable here yet — radius-based geofences and everything else are.
        </p>

        <div style={filterBarStyle}>
          <input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 4 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {SITE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {visibleSites.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No sites match this filter.</p>}
        {visibleSites.map((s) => (
          <div key={s.id} style={rowStyle}>
            {editingId === s.id && draft ? (
              <span style={editGridStyle}>
                <label>Name</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <label>Type</label>
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as Site["type"] })}
                >
                  {SITE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label>Address</label>
                <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                <label>Access instructions</label>
                <input
                  value={draft.access_instructions}
                  onChange={(e) => setDraft({ ...draft, access_instructions: e.target.value })}
                />
                <label>Access hours</label>
                <input
                  value={draft.access_hours}
                  onChange={(e) => setDraft({ ...draft, access_hours: e.target.value })}
                />
                <label>Center lat / lng</label>
                <span style={{ display: "flex", gap: 6 }}>
                  <input
                    value={draft.center_lat}
                    onChange={(e) => setDraft({ ...draft, center_lat: e.target.value })}
                    style={{ width: 100 }}
                  />
                  <input
                    value={draft.center_lng}
                    onChange={(e) => setDraft({ ...draft, center_lng: e.target.value })}
                    style={{ width: 100 }}
                  />
                </span>
                <label>Geofence radius (m)</label>
                <input
                  value={draft.geofence_radius_m}
                  onChange={(e) => setDraft({ ...draft, geofence_radius_m: e.target.value })}
                  style={{ width: 100 }}
                />
                <label>Active start / end</label>
                <span style={{ display: "flex", gap: 6 }}>
                  <input
                    type="date"
                    value={draft.active_start}
                    onChange={(e) => setDraft({ ...draft, active_start: e.target.value })}
                  />
                  <input
                    type="date"
                    value={draft.active_end}
                    onChange={(e) => setDraft({ ...draft, active_end: e.target.value })}
                  />
                </span>
                <span />
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn-primary" onClick={() => saveEdit(s)}>Save</button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setDraft(null);
                    }}
                  >
                    Cancel
                  </button>
                </span>
              </span>
            ) : (
              <>
                <span>
                  <strong>{s.name}</strong>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    — {s.type}
                    {s.address ? ` — ${s.address}` : ""}
                    {s.active_start || s.active_end ? ` — active ${s.active_start ?? "…"} to ${s.active_end ?? "…"}` : ""}
                  </span>
                </span>
                <button onClick={() => startEdit(s)}>Edit</button>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
