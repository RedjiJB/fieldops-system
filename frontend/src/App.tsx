import { useEffect, useRef, useState } from "react";
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

const ADMIN_TABS: { tab: Tab; label: string }[] = [
  { tab: "users", label: "Users" },
  { tab: "payroll", label: "Payroll" },
  { tab: "spending", label: "Spending" },
  { tab: "confirmations", label: "Confirmations" },
  { tab: "compliance", label: "Compliance" },
  { tab: "notification-settings", label: "Notification Settings" },
];

function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("map");
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const onAdminTab = ADMIN_TABS.some((t) => t.tab === tab);

  useEffect(() => {
    if (!adminMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setAdminMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [adminMenuOpen]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="dashboard-header" style={{ padding: "10px 16px", borderBottom: "1px solid #ddd" }}>
        <strong className="dashboard-header-title">FieldOps Dashboard</strong>
        {/* .dashboard-header-nav (index.css) is grid-area: nav, min-width: 0 --
            that min-width: 0 is what lets overflow-x: auto below actually
            engage instead of the browser just growing the nav to fit its
            content, which is what pushed the whole page wider before this
            existed. Below 640px, index.css's media query moves this to its
            own full-width row under title+user, so the scroller has real
            room instead of being squeezed to ~0px next to two other
            fixed-width neighbors. */}
        <nav
          className="dashboard-header-nav"
          style={{ display: "flex", gap: 6, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 2 }}
        >
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
            <button onClick={() => setTab("activity")} disabled={tab === "activity"}>
              Activity
            </button>
            <button onClick={() => setTab("reports")} disabled={tab === "reports"}>
              Reports
            </button>
            <button onClick={() => setTab("timesheets")} disabled={tab === "timesheets"}>
              Timesheets
            </button>
            {isAdmin && (
              // The 6 admin-only surfaces (Users/Payroll/Spending/Confirmations/
              // Compliance/Notification Settings) used to each be their own
              // top-level button -- folding them into one dropdown is most of
              // what fixed nav crowding: only admin/owner ever saw the full
              // 18-button row, since staff never had these 6 to begin with.
              <div ref={adminMenuRef} style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setAdminMenuOpen((v) => !v)} disabled={onAdminTab && !adminMenuOpen}>
                  Admin {adminMenuOpen ? "▴" : "▾"}
                </button>
                {adminMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      marginTop: 4,
                      background: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: 4,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                      zIndex: 10,
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 160,
                    }}
                  >
                    {ADMIN_TABS.map((t) => (
                      <button
                        key={t.tab}
                        onClick={() => {
                          setTab(t.tab);
                          setAdminMenuOpen(false);
                        }}
                        disabled={tab === t.tab}
                        style={{ textAlign: "left", border: "none", borderRadius: 0 }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>
        <div className="dashboard-header-user" style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
