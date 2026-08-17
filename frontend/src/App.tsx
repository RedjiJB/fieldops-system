import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Car,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Package,
  Receipt,
  ShieldAlert,
  Store,
  Truck,
  UserCog,
  Users as UsersIcon,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import logo from "./assets/logo.png";
import { AppBackdrop } from "./components/AppBackdrop";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { ToastProvider } from "./components/Toast";
import { WelcomeBanner } from "./components/WelcomeBanner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ActivityLogPage } from "./pages/ActivityLogPage";
import { AssetsPage } from "./pages/AssetsPage";
import { CarpoolPage } from "./pages/CarpoolPage";
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
  | "ops"
  | "map"
  | "assets"
  | "documents"
  | "crew"
  | "sites"
  | "vehicles"
  | "loadouts"
  | "vendors"
  | "carpool"
  | "activity"
  | "reports"
  | "timesheets"
  | "users"
  | "payroll"
  | "spending"
  | "confirmations"
  | "compliance"
  | "notification-settings";

type NavItem = { tab: Tab; label: string; icon: LucideIcon };

// Grouped the way OpenConstructionERP groups its module sidebar into
// workflow sections, adapted to this app's actual 18 tabs rather than
// its 180 modules -- three shared groups everyone sees, one admin-only
// group folded in for admin/owner (same 6 tabs the old dropdown held).
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ tab: "ops", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Field",
    items: [
      { tab: "map", label: "Map", icon: MapIcon },
      { tab: "assets", label: "Assets", icon: Package },
      { tab: "documents", label: "Documents", icon: FileText },
      { tab: "crew", label: "Crew", icon: UsersIcon },
      { tab: "sites", label: "Sites", icon: Building2 },
      { tab: "vehicles", label: "Vehicles", icon: Truck },
      { tab: "loadouts", label: "Loadouts", icon: Boxes },
      { tab: "vendors", label: "Vendors", icon: Store },
      { tab: "carpool", label: "Carpool", icon: Car },
    ],
  },
  {
    label: "Records",
    items: [
      { tab: "activity", label: "Activity", icon: ActivityIcon },
      { tab: "reports", label: "Reports", icon: BarChart3 },
      { tab: "timesheets", label: "Timesheets", icon: Clock },
    ],
  },
];

const ADMIN_NAV_GROUP: { label: string; items: NavItem[] } = {
  label: "Admin",
  items: [
    { tab: "users", label: "Users", icon: UserCog },
    { tab: "payroll", label: "Payroll", icon: Wallet },
    { tab: "spending", label: "Spending", icon: Receipt },
    { tab: "confirmations", label: "Confirmations", icon: CheckSquare },
    { tab: "compliance", label: "Compliance", icon: ShieldAlert },
    { tab: "notification-settings", label: "Notification Settings", icon: Bell },
  ],
};

function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("ops");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const groups = isAdmin ? [...NAV_GROUPS, ADMIN_NAV_GROUP] : NAV_GROUPS;
  const activeItem = groups.flatMap((g) => g.items).find((i) => i.tab === tab);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Closing the mobile drawer on outside-click, same pattern the old
  // admin dropdown used -- tapping the dimmed backdrop (the drawer's
  // box-shadow trick in index.css) should dismiss it like any drawer.
  //
  // The menuBtnRef exclusion is load-bearing, not defensive: the hamburger
  // lives in .app-topbar, outside the sidebar, so without it a tap on the
  // open drawer's X fired mousedown (this handler -> close) and then click
  // (the button's own toggle -> reopen), leaving the drawer stuck open with
  // no way to dismiss it except selecting a nav item.
  useEffect(() => {
    if (!mobileOpen) return;
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (menuBtnRef.current?.contains(target)) return;
      if (sidebarRef.current && !sidebarRef.current.contains(target)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [mobileOpen]);

  function selectTab(t: Tab) {
    setTab(t);
    setMobileOpen(false);
  }

  return (
    <div className="app-shell">
      <div ref={sidebarRef} className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-header">
          <img src={logo} alt="Sod Boys Ltd" className="brand-logo brand-logo-sidebar sidebar-title" />
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sidebar-section-label">{group.label}</div>
              {group.items.map((item) => (
                <button key={item.tab} className="sidebar-link" onClick={() => selectTab(item.tab)} disabled={tab === item.tab}>
                  <item.icon size={17} />
                  <span className="sidebar-link-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-footer-name">{user?.name}</span>
          <button onClick={() => logout()} title="Log out" style={{ padding: 6, border: "none", background: "transparent" }}>
            <LogOut size={16} />
          </button>
        </div>
        <div className="sidebar-build-stamp">Sod Boys Ltd · {__BUILD_DATE__}</div>
      </div>
      <div className="app-content">
        <div className="app-topbar">
          <button
            ref={menuBtnRef}
            className="app-topbar-menu-btn"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <strong>{activeItem?.label ?? "Sod Boys Ltd"}</strong>
          <span style={{ width: 20 }} />
        </div>
        {user && <WelcomeBanner userId={user.id} userName={user.name} />}
        {tab === "ops" && <OpsOverviewPage onOpenMap={() => setTab("map")} />}
        {tab === "map" && <MapPage />}
        {tab === "assets" && <AssetsPage />}
        {tab === "documents" && <DocumentsPage />}
        {tab === "crew" && <CrewPage />}
        {tab === "sites" && <SitesPage />}
        {tab === "vehicles" && <VehicleHistoryPage />}
        {tab === "loadouts" && <LoadoutsPage />}
        {tab === "vendors" && <VendorsPage />}
        {tab === "carpool" && <CarpoolPage />}
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
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          {/* Mounted once at the root, not per-page: it's position:fixed with a
              negative z-index, so a per-page wrapper would create a stacking
              context and trap it behind that page's own content. */}
          <AppBackdrop />
          <Routed />
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
