import { useEffect, useState } from "react";
import {
  api,
  INSTRUMENT_TYPES,
  SPEND_CATEGORIES,
  SPEND_METHODS,
  SPEND_STATUSES,
  type CrewMember,
  type Document,
  type MoneyInstrument,
  type SpendRecord,
} from "../api/client";
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

function formatMoney(value: number | string | null): string {
  if (value === null) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function NewInstrumentForm({ onCreated }: { onCreated: (mi: MoneyInstrument) => void }) {
  const [type, setType] = useState<MoneyInstrument["type"]>("company_card");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!label) {
      setError("Label is required");
      return;
    }
    try {
      const created = await api.createMoneyInstrument({ type, label });
      onCreated({ ...created, current_holder_name: null });
      setLabel("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create instrument");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
      <select value={type} onChange={(e) => setType(e.target.value as MoneyInstrument["type"])}>
        {INSTRUMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input placeholder="Label (e.g. Company Visa)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <button onClick={submit}>+ New instrument</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

function InstrumentRow({
  instrument,
  crewMembers,
  onUpdated,
}: {
  instrument: MoneyInstrument;
  crewMembers: CrewMember[];
  onUpdated: (mi: MoneyInstrument) => void;
}) {
  const [assignTo, setAssignTo] = useState("");
  const [delta, setDelta] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!assignTo) return;
    try {
      await api.assignMoneyInstrument(instrument.id, assignTo);
      const holder = crewMembers.find((c) => c.id === assignTo);
      onUpdated({ ...instrument, current_holder_name: holder?.name ?? null });
      setAssignTo("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign");
    }
  }

  async function adjustBalance() {
    const value = Number(delta);
    if (delta.trim() === "" || Number.isNaN(value)) {
      setError("delta must be a number");
      return;
    }
    try {
      const updated = await api.adjustMoneyInstrumentBalance(instrument.id, value);
      onUpdated({ ...instrument, balance: updated.balance });
      setDelta("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to adjust balance");
    }
  }

  return (
    <div style={rowStyle}>
      <span>
        <strong>{instrument.label}</strong>
        <span style={{ color: "#888" }}>
          {" "}
          — {instrument.type} — held by {instrument.current_holder_name ?? "nobody"}
          {instrument.type === "petty_cash" && ` — balance ${formatMoney(instrument.balance)}`}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
          <option value="">Assign to…</option>
          {crewMembers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={assign}>Assign</button>
        {instrument.type === "petty_cash" && (
          <>
            <input
              type="number"
              step="0.01"
              placeholder="delta"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              style={{ width: 80 }}
            />
            <button onClick={adjustBalance}>Adjust balance</button>
          </>
        )}
        {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
      </span>
    </div>
  );
}

function NewSpendRecordForm({
  crewMembers,
  instruments,
  documents,
  onCreated,
}: {
  crewMembers: CrewMember[];
  instruments: MoneyInstrument[];
  documents: Document[];
  onCreated: (r: SpendRecord) => void;
}) {
  const [category, setCategory] = useState<SpendRecord["category"]>("material");
  const [method, setMethod] = useState<SpendRecord["method"]>("company_card");
  const [amount, setAmount] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [crewMemberId, setCrewMemberId] = useState("");
  const [instrumentId, setInstrumentId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isMileage = category === "mileage";

  async function submit() {
    setError(null);
    try {
      const created = await api.createSpendRecord({
        category,
        method,
        amount: isMileage ? undefined : Number(amount),
        distance_km: isMileage ? Number(distanceKm) : undefined,
        crew_member_id: crewMemberId || undefined,
        instrument_id: instrumentId || undefined,
        document_id: documentId || undefined,
        description: description || undefined,
      });
      onCreated(created);
      setAmount("");
      setDistanceKm("");
      setCrewMemberId("");
      setInstrumentId("");
      setDocumentId("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record spend");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
      <select value={category} onChange={(e) => setCategory(e.target.value as SpendRecord["category"])}>
        {SPEND_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select value={method} onChange={(e) => setMethod(e.target.value as SpendRecord["method"])}>
        {SPEND_METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {isMileage ? (
        <input
          type="number"
          min="0.01"
          step="0.1"
          placeholder="Distance (km)"
          value={distanceKm}
          onChange={(e) => setDistanceKm(e.target.value)}
          style={{ width: 100 }}
        />
      ) : (
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 100 }}
        />
      )}
      <select value={crewMemberId} onChange={(e) => setCrewMemberId(e.target.value)}>
        <option value="">Crew member (optional)</option>
        {crewMembers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
        <option value="">Instrument (optional)</option>
        {instruments.map((mi) => (
          <option key={mi.id} value={mi.id}>
            {mi.label}
          </option>
        ))}
      </select>
      <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
        <option value="">Link receipt photo (optional)</option>
        {documents.map((d) => (
          <option key={d.id} value={d.id}>
            {d.filename}
          </option>
        ))}
      </select>
      <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <button onClick={submit}>+ Record spend</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

function ApproveControl({ record, onDone }: { record: SpendRecord; onDone: (r: SpendRecord) => void }) {
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setError(null);
    try {
      if (record.category === "mileage") {
        const value = Number(rate);
        if (rate.trim() === "" || Number.isNaN(value) || value < 0) {
          setError("rate_per_km is required");
          return;
        }
        onDone(await api.approveSpendRecord(record.id, value));
      } else {
        onDone(await api.approveSpendRecord(record.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    }
  }

  async function reject() {
    try {
      onDone(await api.rejectSpendRecord(record.id, reason.trim() || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    }
  }

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {record.category === "mileage" && (
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="rate/km"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={{ width: 70 }}
        />
      )}
      {/* Not required -- but a bare rejection with no reason is exactly
          what pushes a crew member to file a dispute out of frustration
          rather than understanding, so the field is right next to the
          button that needs it. */}
      <input
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: 140 }}
      />
      <button onClick={approve}>Approve</button>
      <button onClick={reject}>Reject</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </span>
  );
}

export function SpendingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [instruments, setInstruments] = useState<MoneyInstrument[]>([]);
  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);
  const [receiptDocuments, setReceiptDocuments] = useState<Document[]>([]);
  const [records, setRecords] = useState<SpendRecord[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reloadInstruments() {
    api.moneyInstruments().then(setInstruments).catch((err) => setError(err instanceof Error ? err.message : "Failed to load instruments"));
  }

  function reloadRecords() {
    api
      .spendRecords({ category: categoryFilter || undefined, status: statusFilter || undefined })
      .then(setRecords)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load spend records"));
  }

  useEffect(() => {
    if (!isAdmin) return;
    reloadInstruments();
    api.crewMembers().then(setCrewMembers).catch(() => {});
    api.documents({ type: "receipt" }).then(setReceiptDocuments).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) reloadRecords();
  }, [isAdmin, categoryFilter, statusFilter]);

  if (!isAdmin) {
    return (
      <div style={{ overflowY: "auto", flex: 1 }}>
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 16 }}>Spending</h2>
          <p style={{ color: "#888" }}>Admin access required.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Money instruments</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Company cards and petty cash floats — who has custody right now. Petty cash balance is hand-adjusted, same
          as consumables' on-hand quantity; nothing here auto-decrements it.
        </p>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <NewInstrumentForm onCreated={(mi) => setInstruments((prev) => [...prev, mi])} />

        {instruments.length === 0 && <p style={{ color: "#888" }}>No money instruments on file.</p>}
        {instruments.map((mi) => (
          <InstrumentRow
            key={mi.id}
            instrument={mi}
            crewMembers={crewMembers}
            onUpdated={(updated) => setInstruments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
          />
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Spend records</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Company-card/cash spend is logged already-approved; a personal reimbursement (receipt or mileage) starts
          pending and needs sign-off — mileage's amount is computed at approval from a rate you set then, not typed in
          up front.
        </p>

        <NewSpendRecordForm
          crewMembers={crewMembers}
          instruments={instruments}
          documents={receiptDocuments}
          onCreated={(r) => setRecords((prev) => [r, ...prev])}
        />

        <div style={filterBarStyle}>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {SPEND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {SPEND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {records.length === 0 && <p style={{ color: "#888" }}>No spend records match these filters.</p>}
        {records.map((r) => (
          <div key={r.id} style={rowStyle}>
            <span>
              <strong>{r.category}</strong>
              <span style={{ color: "#888" }}>
                {" "}
                — {r.method} — {r.category === "mileage" ? `${r.distance_km} km` : formatMoney(r.amount)}
                {r.crew_member_name ? ` — ${r.crew_member_name}` : ""}
                {r.instrument_label ? ` — ${r.instrument_label}` : ""}
                {r.description ? ` — ${r.description}` : ""} — {new Date(r.occurred_at).toLocaleString()}
              </span>
              <span
                style={{
                  marginLeft: 8,
                  color:
                    r.status === "rejected"
                      ? "#c0392b"
                      : r.status === "disputed"
                        ? "#a0522d"
                        : r.status === "pending"
                          ? "#c9902f"
                          : "#888",
                  fontWeight: r.status === "pending" || r.status === "disputed" ? "bold" : "normal",
                }}
              >
                {r.status}
              </span>
              {r.status === "rejected" && r.rejection_note && (
                <div style={{ color: "#888", fontSize: 13 }}>Reason: {r.rejection_note}</div>
              )}
              {r.dispute_note && <div style={{ color: "#a0522d", fontSize: 13 }}>Dispute: {r.dispute_note}</div>}
            </span>
            {(r.status === "pending" || r.status === "disputed") && (
              <ApproveControl record={r} onDone={(updated) => setRecords((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))} />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
