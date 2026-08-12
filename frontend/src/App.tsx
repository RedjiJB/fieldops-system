import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <MapPage /> : <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
