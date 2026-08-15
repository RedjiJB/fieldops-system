import { UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import { api, USER_ROLES, type User } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/Button";
import { useAuth } from "../context/AuthContext";

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--color-border)",
};

const MIN_PASSWORD_LENGTH = 8;

function NewUserForm({ onCreated }: { onCreated: (u: User) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("staff");
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
      const created = await api.createUser({ name, email, password, role });
      onCreated(created);
      setName("");
      setEmail("");
      setPassword("");
      setRole("staff");
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
      <select value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
        {USER_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button onClick={submit}>+ New user</button>
      {error && <span style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</span>}
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
      <Button variant="primary" onClick={submit}>Save</Button>
      <button onClick={() => setOpen(false)}>Cancel</button>
      {error && <span style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</span>}
    </span>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  const [users, setUsers] = useState<User[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftRole, setDraftRole] = useState<User["role"]>("staff");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.users().then(setUsers).catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
  }

  useEffect(reload, []);

  function startEdit(u: User) {
    setEditingId(u.id);
    setDraftName(u.name);
    setDraftEmail(u.email);
    setDraftRole(u.role);
  }

  async function saveEdit(u: User) {
    try {
      const updated = await api.updateUser(u.id, { name: draftName, email: draftEmail, role: draftRole });
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
      <section className="card">
        <h2>Users</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Dashboard login accounts. {isAdmin ? "Admins manage accounts; staff have view-only access here." : "View only — ask an admin to make changes."}
        </p>
        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        {isAdmin && <NewUserForm onCreated={(u) => setUsers((prev) => [...prev, u])} />}

        {users.length === 0 && <EmptyState icon={UserCog} title="No users on file" description="Dashboard logins are separate from crew members." />}
        {users.map((u) => (
          <div key={u.id} style={rowStyle}>
            {isAdmin && editingId === u.id ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" as const }}>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" />
                <input value={draftEmail} onChange={(e) => setDraftEmail(e.target.value)} placeholder="Email" />
                <select value={draftRole} onChange={(e) => setDraftRole(e.target.value as User["role"])}>
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <Button variant="primary" onClick={() => saveEdit(u)}>Save</Button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <span>
                  <strong style={{ opacity: u.active ? 1 : 0.5 }}>{u.name}</strong>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    — {u.email} — {u.role}
                    {!u.active ? " — inactive" : ""}
                  </span>
                </span>
                {isAdmin && (
                  <span style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => startEdit(u)}>Edit</button>
                    <ResetPasswordInline user={u} />
                    <button onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Reactivate"}</button>
                  </span>
                )}
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
