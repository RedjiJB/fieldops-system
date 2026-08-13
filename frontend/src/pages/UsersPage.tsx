import { useEffect, useState } from "react";
import { api, type User } from "../api/client";

const sectionStyle = { padding: 16 };
const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f0f0f0",
};

const MIN_PASSWORD_LENGTH = 8;

function NewUserForm({ onCreated }: { onCreated: (u: User) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name || !email || !password) {
      setError("Name, email, and password are all required");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    try {
      const created = await api.createUser({ name, email, password });
      onCreated(created);
      setName("");
      setEmail("");
      setPassword("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        type="password"
        placeholder="Password (min 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={submit}>+ New user</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </div>
  );
}

function ResetPasswordInline({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    try {
      await api.setUserPassword(user.id, newPassword);
      setOpen(false);
      setNewPassword("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Reset password</button>;
  }

  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="password"
        placeholder="New password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        style={{ width: 140 }}
      />
      <button onClick={submit}>Save</button>
      <button onClick={() => setOpen(false)}>Cancel</button>
      {error && <span style={{ color: "#c0392b", fontSize: 13 }}>{error}</span>}
    </span>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.users().then(setUsers).catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
  }

  useEffect(reload, []);

  function startEdit(u: User) {
    setEditingId(u.id);
    setDraftName(u.name);
    setDraftEmail(u.email);
  }

  async function saveEdit(u: User) {
    try {
      const updated = await api.updateUser(u.id, { name: draftName, email: draftEmail });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...updated } : x)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function toggleActive(u: User) {
    const nextActive = !u.active;
    if (!window.confirm(`Mark "${u.name}" as ${nextActive ? "active" : "inactive"}?`)) return;
    try {
      const updated = await api.updateUser(u.id, { active: nextActive });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...updated } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 16 }}>Users</h2>
        <p style={{ color: "#888", fontSize: 13 }}>
          Dashboard login accounts — every account currently has the same access, there are no roles yet.
        </p>
        {error && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <NewUserForm onCreated={(u) => setUsers((prev) => [...prev, u])} />

        {users.length === 0 && <p style={{ color: "#888" }}>No users on file.</p>}
        {users.map((u) => (
          <div key={u.id} style={rowStyle}>
            {editingId === u.id ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" as const }}>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" />
                <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} placeholder="Email" />
                <button onClick={() => saveEdit(u)}>Save</button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <span>
                  <strong style={{ opacity: u.active ? 1 : 0.5 }}>{u.name}</strong>
                  <span style={{ color: "#888" }}>
                    {" "}
                    — {u.email}
                    {!u.active ? " — inactive" : ""}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(u)}>Edit</button>
                  <ResetPasswordInline user={u} />
                  <button onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Reactivate"}</button>
                </span>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
