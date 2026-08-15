import { useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import logo from "../assets/logo.png";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--color-bg)" }}>
      <form
        onSubmit={onSubmit}
        className="card"
        style={{
          width: 340,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "32px 28px 28px",
          boxShadow: "var(--shadow-raised)",
          borderTop: "3px solid var(--color-accent)",
        }}
      >
        <img src={logo} alt="Sod Boys Ltd" className="brand-logo brand-logo-login" />
        <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: 13, margin: "0 0 8px" }}>
          Dashboard sign in
        </p>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div style={{ color: "var(--color-status-bad)", fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
