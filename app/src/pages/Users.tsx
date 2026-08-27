import { useEffect, useState } from "react";
import { api, errMsg } from "../api";
import type { Role, User } from "../types";
import { ErrorBox, Modal, Spinner, useToast } from "../components/ui";

const ROLES: Role[] = ["admin", "editor", "viewer"];

export function Users() {
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<User | null>(null);

  const load = () =>
    api.listUsers().then(setUsers).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);

  const toggleActive = async (u: User) => {
    try {
      await api.setUserActive(u.id, !u.active);
      load();
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  const changeRole = async (u: User, role: string) => {
    try {
      await api.setUserRole(u.id, role);
      load();
      toast.push("ok", `${u.username} is now ${role}`);
    } catch (e) {
      toast.push("err", errMsg(e));
    }
  };

  return (
    <div>
      <div className="toolbar">
        <div className="section-title" style={{ margin: 0 }}><h3>Login Profiles</h3></div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New Profile</button>
      </div>
      <ErrorBox message={error} />
      {!users ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>{u.display_name || "—"}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      style={{ padding: "4px 8px", borderRadius: 6 }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.active ? (
                      <span className="badge badge-green">Active</span>
                    ) : (
                      <span className="badge badge-gray">Disabled</span>
                    )}
                    {u.must_change_password && (
                      <span className="badge badge-blue" style={{ marginLeft: 6 }}>must change pw</span>
                    )}
                  </td>
                  <td className="faint">{u.last_login ?? "never"}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setResetFor(u)}>Reset PW</button>{" "}
                    <button className="btn btn-sm" onClick={() => toggleActive(u)}>
                      {u.active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); toast.push("ok", "Profile created"); }}
        />
      )}
      {resetFor && (
        <ResetPassword
          user={resetFor}
          onClose={() => setResetFor(null)}
          onSaved={() => { setResetFor(null); toast.push("ok", "Password reset"); }}
        />
      )}
    </div>
  );
}

function CreateUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await api.createUser(username.trim(), displayName.trim(), role, password, mustChange);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Modal
      title="New Login Profile"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!username || !password}>Create</button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="form-grid cols-2">
        <div className="field">
          <label>Username *</label>
          <input value={username} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>Display Name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Temporary Password *</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <label className="checkline">
        <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
        Require password change at first login
      </label>
      <p className="hint">
        Roles: <strong>admin</strong> manages users &amp; settings, <strong>editor</strong> can
        add/edit records, <strong>viewer</strong> is read-only.
      </p>
    </Modal>
  );
}

function ResetPassword({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await api.adminResetPassword(user.id, pw);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };
  return (
    <Modal
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={pw.length < 6}>Reset</button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="field">
        <label>New temporary password</label>
        <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="hint">The user will be required to change it at next login.</div>
      </div>
    </Modal>
  );
}
