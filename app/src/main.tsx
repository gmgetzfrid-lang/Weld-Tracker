import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { Boot } from "./Boot";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./components/ui";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Boot gates everything: the auth check and every screen only mount once
        the background database open reports ready. */}
    <Boot>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </Boot>
  </React.StrictMode>
);
