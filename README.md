# Kern Energy Weld Tracker

A desktop application that replaces the **Weld_Log_Statistics** Excel workbook
with a proper Windows app. It keeps every capability of the workbook — the weld
log, welder roster, pipe reference, NDE examination levels and the full suite of
reports — and adds real logins, role-based access, an enforced data model,
search, CSV export and an audit trail.

Built with **Tauri v2** (a tiny native Windows shell) + **SQLite** (an embedded,
file-based database). It installs and runs **without administrator rights** and
needs no server, no Excel and no internet connection.

---

## Download & install (no admin rights)

You do not need Node, Rust, or admin rights to *use* the app — those are only for
building it. The Windows installer is produced automatically by GitHub Actions:

1. Push a tag such as `v0.1.0` (or open the **Actions** tab and run the
   *Build Windows App* workflow manually).
2. Download the artifact **`weld-tracker-windows`** from the workflow run, or grab
   the published **Release** if you pushed a tag.
3. Run `Weld Tracker_x.y.z_x64-setup.exe`. It installs **per-user** into
   `%LOCALAPPDATA%` — Windows will not ask for an administrator password.
   A portable `WeldTracker-portable.exe` is also included if you prefer not to
   install at all.

The database is created automatically in your user profile
(`%APPDATA%\com.kernenergy.weldtracker\weldtracker.db`).

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
- **Weld inches** = nominal size × π, computed automatically.
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
