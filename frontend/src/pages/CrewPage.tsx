import { useEffect, useState } from "react";
import { api, CREW_ROLES, PREFERRED_LANGUAGES, type CrewMember } from "../api/client";

const LANGUAGE_LABELS: Record<(typeof PREFERRED_LANGUAGES)[number], string> = { en: "English", fr: "French" };

const sectionStyle = { padding: 16 };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const };

export function CrewPage() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState<CrewMember["role"]>("crew");
  const [draftLanguage, setDraftLanguage] = useState<CrewMember["preferred_language"]>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .crewMembers({ role: role || undefined, active: active || undefined })
      .then(setCrew)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load crew"));
  }

  useEffect(reload, [role, active]);

  // Client-side, not a server round-trip -- crew lists here are small
  // enough (dozens, not thousands) that filtering the already-loaded array
  // is simpler than adding a ?name= query param, and updates instantly as
  // you type with no extra request.
  const visibleCrew = search.trim()
    ? crew.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : crew;

  function startEdit(member: CrewMember) {
    setEditingId(member.id);
    setDraftName(member.name);
    setDraftRole(member.role);
    setDraftLanguage(member.preferred_language);
  }

  async function saveEdit(member: CrewMember) {
    try {
      // preferred_language has no clear-to-null path on the backend (same
      // COALESCE-only convention as name/role/active on this route) --
      // omitting it here when unset just leaves whatever was there before.
      const updated = await api.updateCrewMember(member.id, {
        name: draftName,
        role: draftRole,
        ...(draftLanguage ? { preferred_language: draftLanguage } : {}),
      });
      setCrew((prev) => prev.map((c) => (c.id === member.id ? { ...c, ...updated } : c)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update crew member");
    }
  }

  async function toggleActive(member: CrewMember) {
    const nextActive = !member.active;
    if (!window.confirm(`Mark "${member.name}" as ${nextActive ? "active" : "inactive"}?`)) return;
    try {
      const updated = await api.updateCrewMember(member.id, { active: nextActive });
      setCrew((prev) => prev.map((c) => (c.id === member.id ? { ...c, ...updated } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update crew member");
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Crew</h2>

        <div style={filterBarStyle}>
          <input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 4 }}
          />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {CREW_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>

        {visibleCrew.length === 0 && <p style={{ color: "#888" }}>No crew members match these filters.</p>}
        {visibleCrew.map((c) => (
          <div key={c.id} style={rowStyle}>
            {editingId === c.id ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={{ padding: 4 }} />
                <select value={draftRole} onChange={(e) => setDraftRole(e.target.value as CrewMember["role"])}>
                  {CREW_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select
                  value={draftLanguage ?? ""}
                  onChange={(e) => setDraftLanguage((e.target.value || null) as CrewMember["preferred_language"])}
                >
                  <option value="">No language preference</option>
                  {PREFERRED_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
                <button onClick={() => saveEdit(c)}>Save</button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <span>
                  <strong style={{ opacity: c.active ? 1 : 0.5 }}>{c.name}</strong>
                  <span style={{ color: "#888" }}>
                    {" "}
                    — {c.phone} — {c.role}
                    {c.preferred_language ? ` — ${LANGUAGE_LABELS[c.preferred_language]}` : ""}
                    {!c.active ? " — inactive" : ""}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(c)}>Edit</button>
                  <button onClick={() => toggleActive(c)}>{c.active ? "Deactivate" : "Reactivate"}</button>
                </span>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
