import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ActivityLogPage } from "./pages/ActivityLogPage";
import { AssetsPage } from "./pages/AssetsPage";
import { CompliancePage } from "./pages/CompliancePage";
import { ConfirmationsPage } from "./pages/ConfirmationsPage";
import { CrewPage } from "./pages/CrewPage";
import { CrewPortalPage } from "./pages/CrewPortalPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { LoadoutsPage } from "./pages/LoadoutsPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { OpsOverviewPage } from "./pages/OpsOverviewPage";
import { PayrollPage } from "./pages/PayrollPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SitesPage } from "./pages/SitesPage";
import { SpendingPage } from "./pages/SpendingPage";
import { TimesheetsPage } from "./pages/TimesheetsPage";
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
  | "activity"
  | "reports"
  | "timesheets"
  | "payroll"
  | "spending"
  | "confirmations"
  | "compliance"
  | "notification-settings";

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
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("users")} disabled={tab === "users"}>
                Users
              </button>
            )}
            <button onClick={() => setTab("activity")} disabled={tab === "activity"}>
              Activity
            </button>
            <button onClick={() => setTab("reports")} disabled={tab === "reports"}>
              Reports
            </button>
            <button onClick={() => setTab("timesheets")} disabled={tab === "timesheets"}>
              Timesheets
            </button>
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("payroll")} disabled={tab === "payroll"}>
                Payroll
              </button>
            )}
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("spending")} disabled={tab === "spending"}>
                Spending
              </button>
            )}
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("confirmations")} disabled={tab === "confirmations"}>
                Confirmations
              </button>
            )}
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("compliance")} disabled={tab === "compliance"}>
                Compliance
              </button>
            )}
            {(user?.role === "admin" || user?.role === "owner") && (
              <button onClick={() => setTab("notification-settings")} disabled={tab === "notification-settings"}>
                Notification Settings
              </button>
            )}
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
      {tab === "reports" && <ReportsPage />}
      {tab === "timesheets" && <TimesheetsPage />}
      {tab === "payroll" && <PayrollPage />}
      {tab === "spending" && <SpendingPage />}
      {tab === "confirmations" && <ConfirmationsPage />}
      {tab === "compliance" && <CompliancePage />}
      {tab === "notification-settings" && <NotificationSettingsPage />}
    </div>
  );
}

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <LoginPage />;
  if (user.identityType === "crew") return <CrewPortalPage />;
  return <Dashboard />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
