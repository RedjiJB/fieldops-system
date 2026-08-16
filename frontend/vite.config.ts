import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  // Footer build stamp. Deliberately not a git hash -- the Docker build
  // context for this service is frontend/ alone, which never includes the
  // repo's .git directory, so a hash would just read "dev" on every real
  // deploy. The build date is simple and always accurate.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});
