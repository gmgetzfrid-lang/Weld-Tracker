import { useEffect, useState } from "react";
import { api } from "./api";
import { SentrixLockup } from "./components/Brand";

type BootStatus = "starting" | "ready" | { failed: string };

/**
 * Startup gate. The database opens on a Rust background thread so the window
 * appears instantly; until it's ready this shows a branded splash instead of
 * a frozen white window, and a failed open shows the actual error instead of
 * the process silently dying.
 */
export function Boot({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BootStatus>("starting");

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const s = await api.bootStatus();
        if (!live) return;
        if (s === "ready") { setStatus("ready"); return; }
        if (s.startsWith("failed:")) { setStatus({ failed: s.slice(7).trim() }); return; }
      } catch { /* IPC not up yet — keep polling */ }
      if (live) setTimeout(poll, 250);
    };
    poll();
    return () => { live = false; };
  }, []);

  if (status === "ready") return <>{children}</>;

  return (
    <div className="auth-wrap">
      <div className="boot-splash">
        <SentrixLockup size={64} />
        {status === "starting" ? (
          <>
            <div className="spinner boot-spinner" />
            <p className="boot-msg">Opening the database…</p>
            <p className="boot-sub">A shared drive or a first-run upgrade can take a few seconds.</p>
          </>
        ) : (
          <>
            <p className="boot-msg boot-err">The database could not be opened.</p>
            <p className="boot-sub">{status.failed}</p>
            <p className="boot-sub">
              Check that the database file (or its network drive) is reachable,
              then close and reopen SENTRIX. Details are in the support log
              under your user folder.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
