import { useState } from "react";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";
import logo from "../assets/kern-energy-logo.png";
import { ErrorBox, Modal, useToast } from "../components/ui";

/** Shown full-screen when `forced` (first login), otherwise as a modal. */
export function ChangePassword({
  forced,
  onClose,
}: {
  forced?: boolean;
  onClose?: () => void;
}) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) return setError("New password must be at least 6 characters.");
    if (next !== confirm) return setError("New passwords do not match.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      const u = await api.currentUser();
      setUser(u);
      toast.push("ok", "Password updated");
      onClose?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form onSubmit={submit}>
      <ErrorBox message={error} />
      <div className="field">
        <label>Current password</label>
        <input
          type="password"
          value={current}
          autoFocus
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label>New password</label>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <button className="btn btn-accent btn-block" disabled={busy}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );

  if (!forced && onClose) {
    return (
      <Modal title="Change password" onClose={onClose}>
        {body}
      </Modal>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img className="auth-logo" src={logo} alt="Kern Energy" />
        <h3 className="auth-title">Set a new password</h3>
        <p className="auth-sub">
          Welcome{user ? `, ${user.display_name || user.username}` : ""}. For
          security you must change the default password before continuing.
        </p>
        {body}
      </div>
    </div>
  );
}
