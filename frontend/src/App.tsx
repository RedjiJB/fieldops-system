import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ActivityLogPage } from "./pages/ActivityLogPage";
import { AssetsPage } from "./pages/AssetsPage";
import { CrewPage } from "./pages/CrewPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { LoadoutsPage } from "./pages/LoadoutsPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { OpsOverviewPage } from "./pages/OpsOverviewPage";
import { SitesPage } from "./pages/SitesPage";
import { UsersPage } from "./pages/UsersPage";
import { VehicleHistoryPage } from "./pages/VehicleHistoryPage";
import { VendorsPage } from "./pages/VendorsPage";

type Tab =
  | "map"
  | "ops"
  | "assets"
  | "documents"
  | "crew"
  | "sites"
  | "vehicles"
  | "loadouts"
  | "vendors"
  | "users"
  | "activity";

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
            <button onClick={() => setTab("crew")} disabled={tab === "crew"}>
              Crew
            </button>
            <button onClick={() => setTab("sites")} disabled={tab === "sites"}>
              Sites
            </button>
            <button onClick={() => setTab("vehicles")} disabled={tab === "vehicles"}>
              Vehicles
            </button>
            <button onClick={() => setTab("loadouts")} disabled={tab === "loadouts"}>
              Loadouts
            </button>
            <button onClick={() => setTab("vendors")} disabled={tab === "vendors"}>
              Vendors
            </button>
            <button onClick={() => setTab("users")} disabled={tab === "users"}>
              Users
            </button>
            <button onClick={() => setTab("activity")} disabled={tab === "activity"}>
              Activity
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
      {tab === "crew" && <CrewPage />}
      {tab === "sites" && <SitesPage />}
      {tab === "vehicles" && <VehicleHistoryPage />}
      {tab === "loadouts" && <LoadoutsPage />}
      {tab === "vendors" && <VendorsPage />}
      {tab === "users" && <UsersPage />}
      {tab === "activity" && <ActivityLogPage />}
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
