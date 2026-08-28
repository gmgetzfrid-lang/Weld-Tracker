# SENTRIX — Assurance Console

**SENTRIX** is a weld & NDE quality-assurance desktop app — the Assurance
Console. Its first module replaces the **Weld_Log_Statistics** Excel workbook
with a proper Windows app: it keeps every capability of the workbook — the weld
log, welder roster, isometric weld mapping, pipe reference, EP 5-5-1 Table 4 NDE
determination and the full suite of reports — and adds real logins, role-based
access, an enforced data model, document control, search, CSV export and an
audit trail.

Built with **Tauri v2** (a tiny native Windows shell) + **SQLite** (an embedded,
file-based database). It installs and runs **without administrator rights** and
needs no server, no Excel and no internet connection.

---

## Download

You do not need Node, Rust, or admin rights to *use* the app — those are only for
building it. GitHub Actions builds the Windows binaries automatically: download the
**`sentrix-windows`** artifact from a green *Build Windows App* run (or the
published **Release** if you pushed a `v*` tag). It contains:

- `Sentrix_x.y.z_x64-setup.exe` — the installer
- `WeldTracker-portable.exe` — the no-install executable
- `weld-tracker.portable` — a marker that enables shared mode
- `READ-ME-FIRST.txt` — deployment steps

## Deployment — shared team database vs. single PC

**Shared (a team on a network drive) — the usual choice.** Everyone logs in with
their own profile and reads/writes the same data:

1. Copy **`WeldTracker-portable.exe`** and **`weld-tracker.portable`** together into
   a folder on your network drive, e.g. `\\server\apps\WeldTracker\`.
2. Each person runs `WeldTracker-portable.exe` from that folder — no install, no
   admin rights.
3. The shared SQLite database is created once in a `data\` subfolder **next to the
   exe on the share**, so all users see the same work orders, welds and reports.

Prefer to point at an explicit file? Put a `weld-tracker.json` next to the exe:

```json
{ "database_path": "\\\\server\\apps\\WeldTracker\\data\\weldtracker.db" }
```

(or set the `WELDTRACKER_DB` environment variable to that path.)

**Single PC.** Run `...-setup.exe` (installs per-user into `%LOCALAPPDATA%`, no
admin). Its database stays on that machine at
`%APPDATA%\com.kernenergy.weldtracker\weldtracker.db`.

**Where the data lives** is resolved in this order: `WELDTRACKER_DB` env var →
`weld-tracker.json` next to the exe → `data\weldtracker.db` next to the exe (when
the `weld-tracker.portable` marker is present) → per-user app data. When the
database is shared, the app uses network-safe locking (rollback journal +
busy-timeout) so concurrent users don't collide. **Settings → About** shows the
exact database file each user is on.

> Concurrency note: a shared SQLite file on an SMB share is well suited to a small
> team logging welds. If you grow to many people writing at the exact same instant
> and want bulletproof concurrency, the natural next step is a small database
> server (e.g. Postgres) — ask and it can be added.

## First sign-in

| Username | Password   |
| -------- | ---------- |
| `admin`  | `password` |

You are **required to set a new password** on first login. After that, an admin
can create additional login profiles (**Administration → Users**) with one of
three roles:

- **admin** – manage users, settings and everything below
- **editor** – add / edit / delete welds and welders
- **viewer** – read-only access to all records and reports

New profiles can be given a temporary password that must be changed at first
login.

---

## What it does (mapped from the workbook)

| Workbook sheet(s) | App screen |
| --- | --- |
| WELD LOG | **Weld Log** — searchable/filterable grid; full 44-field editor; status colour-coding; rejected-weld repair + tracer automation |
| WELDER ROSTER / Welder List / Stamp List | **Welder Roster** — stamps, WPQs, status, training; sort by name or stamp; active/inactive |
| Summary / Weld Count PVT | **Dashboard** — totals, RT coverage, reject rate, weld inches, breakdown by joint type |
| WELDER % (5/10/20/25/50/100% pivots) | **Welder Statistics** — per-welder counts by NDE examination level |
| *(new)* | **NDE Statistics** — per-welder NDE **compliance** vs. spec (5/10/20/100 % coverage and API 570 in lieu of hydro), a below-spec watchlist, welder performance and reject-rate charts |
| WELDER REPORT | **Welder Report** — single-welder detail by joint type |
| Monthly Report | **Monthly Report** — 12-month weld counts, RT and reject trends |
| Daily Weld Count | **Daily Weld Count** — per-day counts + recent-days table |
| Job Report | **Job Report** — totals by work order |
| Chevron Report | **Client / TSA Report** — per-welder monthly summary with reject rate |
| QM PVT | **QM Summary** — quality-manager roll-up |
| Pipe Table | **Pipe Table** — wall thickness by size × schedule (drives auto lookups) |
| CRITERIA LEGEND | **Criteria Legend** |
| Instruction | **Instructions** — repair procedure + status guide |

### Preserved logic
- **Weld inches** = diameter inches (the nominal pipe size / NPS), computed
  automatically — a 6″ pipe is 6 weld inches.
- **Wall thickness** looked up from the Pipe Table by size + schedule.
- **Joint types** BW / SW / O-Let / Fillet / Other.
- **NDE levels** 5 / 10 / 20 / 25 / 50 / 100 % RT coverage, filterable in stats.
- **Statuses** Required / Requested / Pending / PWHT / Clear (same colours as the
  workbook's conditional formatting).
- **Rejected-weld repair**: one click creates the `nR1` repair row (welder + NDE
  cleared) and the `nT1`/`nT2` welder tracers, exactly as the Instruction sheet
  describes.
- **Count Omission** excludes a weld from every count and report.
- **RT % = RT'd ÷ welds**, **Reject rate = rejected ÷ RT'd** (the Client/TSA
  report uses rejected ÷ weld count, matching the Chevron sheet).

### Added beyond the workbook
Real user accounts & roles, enforced field validation, global search, one-click
CSV export on every report, an audit log of changes, and a robust relational
database in place of fragile pivot tables and `GETPIVOTDATA` formulas.

---

## Project layout

```
app/
├── weldcore/       Pure-Rust domain crate: SQLite schema, auth, CRUD, reports (unit-tested)
├── src-tauri/      Tauri v2 shell: command layer + window/bundle config
├── src/            React + TypeScript UI (pages, components, design system)
└── package.json    Frontend build
.github/workflows/build.yml   Windows installer CI
```

## Building it yourself (developers only)

Requires Node 20+, Rust stable, and the Tauri prerequisites for your OS.

```bash
cd app
npm install
npm run tauri dev      # run locally
npm run tauri build -- --bundles nsis   # produce the Windows installer
```

Run the core logic tests (no GUI toolkit needed):

```bash
cd app
cargo test -p weldcore
```
