import { useEffect, useState } from "react";
import { api, DOCUMENT_TYPES, type Document } from "../api/client";

const sectionStyle = { padding: 16, borderBottom: "1px solid #eee" };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
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
          <span style={{ color: "#888" }}>
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
      {error && <div style={{ padding: 8, color: "#c0392b" }}>{error}</div>}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Expiring soon (next {EXPIRING_WITHIN_DAYS} days)</h2>
        {expiring.length === 0 && <p style={{ color: "#888" }}>Nothing expiring or overdue.</p>}
        {expiring.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>All documents</h2>
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
        {documents.length === 0 && <p style={{ color: "#888" }}>No documents match this filter.</p>}
        {documents.map((d) => (
          <DocumentRow key={d.id} doc={d} />
        ))}
      </section>
    </div>
  );
}
