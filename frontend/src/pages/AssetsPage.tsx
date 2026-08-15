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
          <div key={a.id} style={rowStyle}>
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
        ))}
      </section>
    </div>
  );
}
