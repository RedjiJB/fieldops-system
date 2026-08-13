import { useEffect, useState } from "react";
import {
  api,
  type Asset,
  type Consumable,
  type JobType,
  type Loadout,
  type LoadoutDetail,
  type NewLoadoutItem,
} from "../api/client";

const pageStyle = { display: "flex", flex: 1, overflow: "hidden" };
const listColStyle = { width: 320, borderRight: "1px solid #eee", overflowY: "auto" as const, padding: 16 };
const detailColStyle = { flex: 1, overflowY: "auto" as const, padding: 16 };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};
const itemFormStyle = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginTop: 12 };

type ItemPickerState = {
  kind: "asset" | "consumable";
  itemId: string;
  quantity: string;
  scalesWithCrew: boolean;
};

function emptyPicker(): ItemPickerState {
  return { kind: "asset", itemId: "", quantity: "1", scalesWithCrew: false };
}

function toNewItem(p: ItemPickerState): NewLoadoutItem | null {
  if (!p.itemId) return null;
  const quantity = Number(p.quantity);
  if (!quantity || quantity <= 0) return null;
  return {
    asset_id: p.kind === "asset" ? p.itemId : undefined,
    consumable_id: p.kind === "consumable" ? p.itemId : undefined,
    quantity,
    scales_with_crew: p.scalesWithCrew,
  };
}

function ItemPicker({
  assets,
  consumables,
  value,
  onChange,
}: {
  assets: Asset[];
  consumables: Consumable[];
  value: ItemPickerState;
  onChange: (v: ItemPickerState) => void;
}) {
  const options = value.kind === "asset" ? assets : consumables;
  return (
    <span style={itemFormStyle}>
      <select
        value={value.kind}
        onChange={(e) => onChange({ ...value, kind: e.target.value as "asset" | "consumable", itemId: "" })}
      >
        <option value="asset">Asset</option>
        <option value="consumable">Consumable</option>
      </select>
      <select value={value.itemId} onChange={(e) => onChange({ ...value, itemId: e.target.value })}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="any"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        style={{ width: 70 }}
      />
      <label style={{ fontSize: 13 }}>
        <input
          type="checkbox"
          checked={value.scalesWithCrew}
          onChange={(e) => onChange({ ...value, scalesWithCrew: e.target.checked })}
        />{" "}
        scales with crew size
      </label>
    </span>
  );
}

export function LoadoutsPage() {
  const [loadouts, setLoadouts] = useState<Loadout[]>([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [filterJobType, setFilterJobType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoadoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingHeader, setEditingHeader] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftJobType, setDraftJobType] = useState("");
  const [newItem, setNewItem] = useState<ItemPickerState>(emptyPicker());

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createJobType, setCreateJobType] = useState("");
  const [createItems, setCreateItems] = useState<NewLoadoutItem[]>([]);
  const [createItemDraft, setCreateItemDraft] = useState<ItemPickerState>(emptyPicker());

  function reloadList() {
    api
      .loadouts({ job_type_id: filterJobType || undefined })
      .then(setLoadouts)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load loadouts"));
  }

  useEffect(reloadList, [filterJobType]);

  useEffect(() => {
    api.jobTypes().then(setJobTypes).catch(() => {});
    api.assets({}).then(setAssets).catch(() => {});
    api.consumables().then(setConsumables).catch(() => {});
  }, []);

  function loadDetail(id: string) {
    setSelectedId(id);
    setCreating(false);
    setEditingHeader(false);
    api
      .loadout(id)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load loadout"));
  }

  function nameFor(kind: "asset" | "consumable", id: string): string {
    const source = kind === "asset" ? assets : consumables;
    return source.find((o) => o.id === id)?.name ?? "unknown item";
  }

  function startEditHeader() {
    if (!detail) return;
    setDraftName(detail.name);
    setDraftJobType(detail.job_type_id ?? "");
    setEditingHeader(true);
  }

  async function saveHeader() {
    if (!detail) return;
    try {
      const updated = await api.updateLoadout(detail.id, {
        name: draftName,
        job_type_id: draftJobType || null,
      });
      setDetail({ ...detail, ...updated });
      setLoadouts((prev) => prev.map((l) => (l.id === detail.id ? { ...l, ...updated } : l)));
      setEditingHeader(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update loadout");
    }
  }

  async function deleteLoadout() {
    if (!detail) return;
    if (!window.confirm(`Delete loadout "${detail.name}" and all its items?`)) return;
    try {
      await api.deleteLoadout(detail.id);
      setLoadouts((prev) => prev.filter((l) => l.id !== detail.id));
      setDetail(null);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete loadout");
    }
  }

  async function addItem() {
    if (!detail) return;
    const item = toNewItem(newItem);
    if (!item) {
      setError("Pick an item and a positive quantity first");
      return;
    }
    try {
      const added = await api.addLoadoutItem(detail.id, item);
      setDetail({ ...detail, items: [...detail.items, { ...added, item_name: nameFor(newItem.kind, newItem.itemId) }] });
      setNewItem(emptyPicker());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    }
  }

  async function updateItemQuantity(itemId: string, quantity: number) {
    if (!detail || !quantity || quantity <= 0) return;
    try {
      const updated = await api.updateLoadoutItem(itemId, { quantity });
      setDetail({ ...detail, items: detail.items.map((i) => (i.id === itemId ? { ...i, ...updated } : i)) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item");
    }
  }

  async function toggleItemScales(itemId: string, scalesWithCrew: boolean) {
    if (!detail) return;
    try {
      const updated = await api.updateLoadoutItem(itemId, { scales_with_crew: scalesWithCrew });
      setDetail({ ...detail, items: detail.items.map((i) => (i.id === itemId ? { ...i, ...updated } : i)) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item");
    }
  }

  async function removeItem(itemId: string, itemName: string) {
    if (!detail) return;
    if (!window.confirm(`Remove "${itemName}" from this loadout?`)) return;
    try {
      await api.deleteLoadoutItem(itemId);
      setDetail({ ...detail, items: detail.items.filter((i) => i.id !== itemId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
    }
  }

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDetail(null);
    setCreateName("");
    setCreateJobType("");
    setCreateItems([]);
    setCreateItemDraft(emptyPicker());
  }

  function addCreateItem() {
    const item = toNewItem(createItemDraft);
    if (!item) {
      setError("Pick an item and a positive quantity first");
      return;
    }
    setCreateItems((prev) => [...prev, item]);
    setCreateItemDraft(emptyPicker());
  }

  async function submitCreate() {
    if (!createName) {
      setError("Name is required");
      return;
    }
    if (createItems.length === 0) {
      setError("Add at least one item before creating the loadout");
      return;
    }
    try {
      const created = await api.createLoadout({
        name: createName,
        job_type_id: createJobType || null,
        items: createItems,
      });
      setCreating(false);
      reloadList();
      loadDetail(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create loadout");
    }
  }

  return (
    <div style={pageStyle}>
      <div style={listColStyle}>
        <h2 style={{ fontSize: 16 }}>Loadout Templates</h2>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div style={{ marginBottom: 12 }}>
          <select value={filterJobType} onChange={(e) => setFilterJobType(e.target.value)} style={{ width: "100%" }}>
            <option value="">All job types</option>
            {jobTypes.map((jt) => (
              <option key={jt.id} value={jt.id}>
                {jt.name}
              </option>
            ))}
          </select>
        </div>

        <button onClick={startCreate} style={{ marginBottom: 12 }}>
          + New loadout
        </button>

        {loadouts.length === 0 && <p style={{ color: "#888" }}>No loadouts match this filter.</p>}
        {loadouts.map((l) => (
          <div
            key={l.id}
            onClick={() => loadDetail(l.id)}
            style={{
              padding: "8px 4px",
              cursor: "pointer",
              fontWeight: selectedId === l.id ? "bold" : "normal",
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            {l.name}
          </div>
        ))}
      </div>

      <div style={detailColStyle}>
        {creating && (
          <>
            <h2 style={{ fontSize: 16 }}>New loadout</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input placeholder="Name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
              <select value={createJobType} onChange={(e) => setCreateJobType(e.target.value)}>
                <option value="">No job type</option>
                {jobTypes.map((jt) => (
                  <option key={jt.id} value={jt.id}>
                    {jt.name}
                  </option>
                ))}
              </select>
            </div>

            <h3 style={{ fontSize: 14 }}>Items</h3>
            {createItems.length === 0 && <p style={{ color: "#888" }}>No items added yet.</p>}
            {createItems.map((it, idx) => (
              <div key={idx} style={rowStyle}>
                <span>
                  {nameFor(it.asset_id ? "asset" : "consumable", (it.asset_id ?? it.consumable_id) as string)} —{" "}
                  {it.quantity}
                  {it.scales_with_crew ? " (scales with crew)" : ""}
                </span>
                <button onClick={() => setCreateItems((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            <ItemPicker assets={assets} consumables={consumables} value={createItemDraft} onChange={setCreateItemDraft} />
            <div style={{ marginTop: 8 }}>
              <button onClick={addCreateItem}>Add item to draft</button>
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={submitCreate}>Create loadout</button>
              <button onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </>
        )}

        {!creating && !detail && <p style={{ color: "#888" }}>Select a loadout, or create a new one.</p>}

        {!creating && detail && (
          <>
            {editingHeader ? (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                <select value={draftJobType} onChange={(e) => setDraftJobType(e.target.value)}>
                  <option value="">No job type</option>
                  {jobTypes.map((jt) => (
                    <option key={jt.id} value={jt.id}>
                      {jt.name}
                    </option>
                  ))}
                </select>
                <button onClick={saveHeader}>Save</button>
                <button onClick={() => setEditingHeader(false)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ fontSize: 16 }}>
                  {detail.name}
                  <span style={{ color: "#888", fontWeight: "normal" }}>
                    {" "}
                    — {jobTypes.find((jt) => jt.id === detail.job_type_id)?.name ?? "no job type"}
                  </span>
                </h2>
                <span style={{ display: "flex", gap: 8 }}>
                  <button onClick={startEditHeader}>Edit</button>
                  <button onClick={deleteLoadout}>Delete loadout</button>
                </span>
              </div>
            )}

            <h3 style={{ fontSize: 14 }}>Items</h3>
            {detail.items.length === 0 && <p style={{ color: "#888" }}>No items in this loadout.</p>}
            {detail.items.map((item) => (
              <div key={item.id} style={rowStyle}>
                <span>{item.item_name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={item.quantity}
                    onBlur={(e) => updateItemQuantity(item.id, Number(e.target.value))}
                    style={{ width: 70 }}
                  />
                  <label style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={item.scales_with_crew}
                      onChange={(e) => toggleItemScales(item.id, e.target.checked)}
                    />{" "}
                    scales with crew
                  </label>
                  <button onClick={() => removeItem(item.id, item.item_name)}>Remove</button>
                </span>
              </div>
            ))}

            <h3 style={{ fontSize: 14, marginTop: 16 }}>Add item</h3>
            <ItemPicker assets={assets} consumables={consumables} value={newItem} onChange={setNewItem} />
            <div style={{ marginTop: 8 }}>
              <button onClick={addItem}>Add item</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
