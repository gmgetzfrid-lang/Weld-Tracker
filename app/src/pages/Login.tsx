import { useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import { SentrixLockup } from "../components/Brand";
import type { Settings } from "../types";
import { ErrorBox } from "../components/ui";
import { APP_NAME, APP_VERSION } from "../version";

export function Login({ settings }: { settings: Settings }) {
  const { setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
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
      <div className="auth-hero">
        {/* Wide screens: the brand pane carries the identity and the card is
            pure sign-in; narrow screens hide the pane and the card shows its
            own lockup again — the original centered look. */}
        <div className="auth-brandpane">
          <SentrixLockup size={84} />
          <p className="auth-lead">{settings.company_tagline || "Weld & NDE quality assurance"}</p>
          <ul className="auth-points">
            <li><span className="auth-point-ico">🗂️</span> Work orders, isometrics and the living weld log</li>
            <li><span className="auth-point-ico">◎</span> Weld maps with guided attribute fill</li>
            <li><span className="auth-point-ico">✓</span> NDE requirements computed per weld — EP 5-5-1</li>
            <li><span className="auth-point-ico">📈</span> Welder performance and compliance reporting</li>
          </ul>
          <div className="auth-footline">{APP_NAME} v{APP_VERSION}{settings.company_name ? ` · ${settings.company_name}` : ""}</div>
        </div>

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
              placeholder="your username"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <div className="pw-wrap">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
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
    </div>
  );
}
