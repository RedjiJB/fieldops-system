import { useEffect, useState } from "react";
import { api, ASSET_DIRECTLY_SETTABLE_STATUSES, type Asset } from "../api/client";

const sectionStyle = { padding: 16 };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};
const filterBarStyle = { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" as const };

// Calendar-interval maintenance schedule, inline per row -- matches this
// page's plain row+inline-control style, no modal/expand-toggle like
// OpsOverviewPage's order rows.
function MaintenanceControls({
  asset,
  onSetSchedule,
  onLogService,
}: {
  asset: Asset;
  onSetSchedule: (asset: Asset, days: number | null) => void;
  onLogService: (asset: Asset) => void;
}) {
  const [draft, setDraft] = useState(asset.service_interval_days?.toString() ?? "");

  const dueDate = asset.next_service_due ? new Date(asset.next_service_due) : null;
  const overdue = dueDate ? dueDate.getTime() < Date.now() : false;

  function submit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onSetSchedule(asset, null);
      return;
    }
    const days = Number(trimmed);
    if (!Number.isInteger(days) || days <= 0) return;
    onSetSchedule(asset, days);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#888", marginTop: 2 }}>
      {dueDate ? (
        <span style={overdue ? { color: "#c0392b", fontWeight: "bold" } : undefined}>
          {overdue ? "Maintenance overdue: " : "Next service due: "}
          {dueDate.toLocaleDateString()}
        </span>
      ) : (
        <span>No maintenance schedule</span>
      )}
      <input
        type="number"
        min={1}
        placeholder="days"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: 60, padding: 2 }}
      />
      <button onClick={submit} style={{ fontSize: 12 }}>
        Set interval
      </button>
      {asset.service_interval_days != null && (
        <button onClick={() => onLogService(asset)} style={{ fontSize: 12 }}>
          Log service
        </button>
      )}
    </div>
  );
}

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState("");
  const [siteId, setSiteId] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);

  function reload() {
    api
      .assets({ status: status || undefined, site_id: siteId || undefined, category: category || undefined })
      .then((a) => {
        setAssets(a);
        setSelectedIds(new Set());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load assets"));
  }

  useEffect(() => {
    api.sites().then(setSites).catch(() => {});
  }, []);

  useEffect(reload, [status, siteId, category]);

  // Name search stays client-side and separate from category above --
  // category is a server-side exact-match filter, this is a live substring
  // match over whatever's already loaded.
  const visibleAssets = search.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : assets;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function onChangeStatus(asset: Asset, newStatus: string) {
    if (!window.confirm(`Change "${asset.name}" status to "${newStatus}"?`)) return;
    try {
      const updated = await api.updateAssetStatus(asset.id, newStatus);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update asset status");
    }
  }

  async function onSetSchedule(asset: Asset, days: number | null) {
    try {
      const updated = await api.setAssetMaintenanceSchedule(asset.id, days);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update maintenance schedule");
    }
  }

  async function onLogService(asset: Asset) {
    if (!window.confirm(`Log "${asset.name}" as serviced today?`)) return;
    try {
      const updated = await api.logAssetService(asset.id);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log service");
    }
  }

  // Same directly-settable restriction as the per-row dropdown -- "available"
  // is never offered, since only verify_asset can put an asset there (see
  // AGENTS.md's business rules). Independent per-asset operations, so one
  // failure doesn't block the rest -- reports a partial-failure count.
  async function onBulkChangeStatus() {
    if (!bulkStatus || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    if (!window.confirm(`Change ${ids.length} selected asset${ids.length === 1 ? "" : "s"} to "${bulkStatus}"?`)) return;
    setBulkApplying(true);
    setError(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.updateAssetStatus(id, bulkStatus)));
      const updatedById = new Map<string, Asset>();
      ids.forEach((id, i) => {
        const r = results[i];
        if (r.status === "fulfilled") updatedById.set(id, r.value);
      });
      const failedCount = results.filter((r) => r.status === "rejected").length;
      setAssets((prev) => prev.map((a) => (updatedById.has(a.id) ? { ...a, ...updatedById.get(a.id) } : a)));
      setSelectedIds((prev) => new Set([...prev].filter((id) => !updatedById.has(id))));
      if (failedCount > 0) setError(`${failedCount} of ${ids.length} assets failed to update.`);
      else setBulkStatus("");
    } finally {
      setBulkApplying(false);
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Assets</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Verification stays a WhatsApp/crew action — this view browses and reports status only.
        </p>

        <div style={filterBarStyle}>
          <input
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 4 }}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="available">available</option>
            {ASSET_DIRECTLY_SETTABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ padding: 4 }}
          />
        </div>

        {visibleAssets.length === 0 && <p style={{ color: "#888" }}>No assets match these filters.</p>}
        {selectedIds.size > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>{selectedIds.size} selected</span>
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">Set status to…</option>
              {ASSET_DIRECTLY_SETTABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button onClick={onBulkChangeStatus} disabled={!bulkStatus || bulkApplying}>
              {bulkApplying ? "Applying…" : "Apply"}
            </button>
          </div>
        )}
        {visibleAssets.map((a) => (
          <div key={a.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <input
                  type="checkbox"
                  checked={selectedIds.has(a.id)}
                  onChange={() => toggleSelected(a.id)}
                  style={{ marginRight: 8 }}
                />
                <strong>{a.name}</strong>
                <span style={{ color: "#888" }}> ({a.category})</span>
                <span style={{ color: "#888" }}>
                  {" "}
                  — {a.current_site_name ?? "no site on record"}
                  {a.current_holder_name ? `, held by ${a.current_holder_name}` : ""}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <em>{a.status}</em>
                <select value="" onChange={(e) => e.target.value && onChangeStatus(a, e.target.value)}>
                  <option value="">Change status…</option>
                  {ASSET_DIRECTLY_SETTABLE_STATUSES.filter((s) => s !== a.status).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <MaintenanceControls asset={a} onSetSchedule={onSetSchedule} onLogService={onLogService} />
          </div>
        ))}
      </section>
    </div>
  );
}
