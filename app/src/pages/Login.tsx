import { useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { SentrixLockup } from "../components/Brand";
import type { Settings } from "../types";
import { ErrorBox } from "../components/ui";

export function Login({ settings }: { settings: Settings }) {
  const { setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await api.login(username.trim(), password);
      setUser(user);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <SentrixLockup />
        <p className="auth-sub">
          {settings.company_tagline || "Weld & NDE quality assurance"}
        </p>
        <h3 className="auth-title">Sign in</h3>
        <ErrorBox message={error} />
        <form onSubmit={submit}>
          <div className="field">
            <label>Username</label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button
            className="btn btn-accent btn-block"
            type="submit"
            disabled={busy || !username || !password}
            style={{ marginTop: 6 }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
