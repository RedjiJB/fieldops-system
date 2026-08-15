import { FileText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, DOCUMENT_TYPES, type Document } from "../api/client";
import { EmptyState } from "../components/EmptyState";

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};

const EXPIRING_WITHIN_DAYS = 30;

function fileUrl(id: string): string {
  return `/api/v1/documents/${id}/file`;
}

function DocumentRow({ doc }: { doc: Document }) {
  const isImage = doc.mime_type?.startsWith("image/");
  return (
    <div key={doc.id} style={rowStyle}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isImage && (
          <img src={fileUrl(doc.id)} alt={doc.filename} style={{ width: 40, height: 40, objectFit: "cover" }} />
        )}
        <span>
          <strong>{doc.filename}</strong>
          <span style={{ color: "var(--color-text-muted)" }}>
            {" "}
            — {doc.type} — {doc.site_name ?? "no site on record"}
            {doc.expiry_date ? ` — expires ${doc.expiry_date}` : ""}
          </span>
        </span>
      </span>
      <a href={fileUrl(doc.id)} target="_blank" rel="noreferrer">
        {isImage ? "View" : "Download"}
      </a>
    </div>
  );
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [expiring, setExpiring] = useState<Document[]>([]);
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([api.documents({ type: type || undefined }), api.expiringDocuments(EXPIRING_WITHIN_DAYS)])
      .then(([docs, exp]) => {
        setDocuments(docs);
        setExpiring(exp);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load documents"));
  }

  useEffect(reload, [type]);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {error && <div style={{ padding: 8, color: "var(--color-status-bad)" }}>{error}</div>}

      <section className="card">
        <h2>Expiring soon (next {EXPIRING_WITHIN_DAYS} days)</h2>
        {expiring.length === 0 && <EmptyState icon={ShieldCheck} title="Nothing expiring or overdue" description="Every document on file is currently in date." />}
        {expiring.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </section>

      <section className="card">
        <h2>All documents</h2>
        <div style={{ marginBottom: 12 }}>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {documents.length === 0 && <EmptyState icon={FileText} title="No documents match this filter" description="Documents uploaded over WhatsApp will appear here." />}
        {documents.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </section>
    </div>
  );
}
