import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AssetsPage } from "./pages/AssetsPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { OpsOverviewPage } from "./pages/OpsOverviewPage";

type Tab = "map" | "ops" | "assets" | "documents";

function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("map");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid #ddd",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <strong>FieldOps Dashboard</strong>
          <nav style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTab("map")} disabled={tab === "map"}>
              Map
            </button>
            <button onClick={() => setTab("ops")} disabled={tab === "ops"}>
              Ops
            </button>
            <button onClick={() => setTab("assets")} disabled={tab === "assets"}>
              Assets
            </button>
            <button onClick={() => setTab("documents")} disabled={tab === "documents"}>
              Documents
            </button>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>{user?.name}</span>
          <button onClick={() => logout()}>Log out</button>
        </div>
      </header>
      {tab === "map" && <MapPage />}
      {tab === "ops" && <OpsOverviewPage />}
      {tab === "assets" && <AssetsPage />}
      {tab === "documents" && <DocumentsPage />}
    </div>
  );
}

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Dashboard /> : <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
