import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  ready: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  can: (level: "admin" | "editor") => boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  setUser: () => {},
  logout: async () => {},
  can: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Restore any live session (the Rust side keeps it for the process life).
    api
      .currentUser()
      .then((u) => setUser(u))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  const can = (level: "admin" | "editor") => {
    if (!user) return false;
    if (level === "admin") return user.role === "admin";
    return user.role === "admin" || user.role === "editor";
  };

  return (
    <Ctx.Provider value={{ user, ready, setUser, logout, can }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
