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
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .assets({ status: status || undefined, site_id: siteId || undefined, category: category || undefined })
      .then(setAssets)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load assets"));
  }

  useEffect(() => {
    api.sites().then(setSites).catch(() => {});
  }, []);

  useEffect(reload, [status, siteId, category]);

  async function onChangeStatus(asset: Asset, newStatus: string) {
    if (!window.confirm(`Change "${asset.name}" status to "${newStatus}"?`)) return;
    try {
      const updated = await api.updateAssetStatus(asset.id, newStatus);
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update asset status");
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

        {assets.length === 0 && <p style={{ color: "#888" }}>No assets match these filters.</p>}
        {assets.map((a) => (
          <div key={a.id} style={rowStyle}>
            <span>
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
