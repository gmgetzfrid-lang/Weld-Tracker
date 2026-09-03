import { StatusBadge } from "../components/ui";

export function Instructions() {
  return (
    <div className="grid" style={{ gap: 18, maxWidth: 980 }}>
      <div className="card card-pad">
        <h3>Rejected Weld / Repair Procedure</h3>
        <p className="muted">
          When a weld is rejected, a repair weld and welder tracers must be
          recorded. The app automates this from the weld editor.
        </p>
        <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Open the rejected weld and mark <strong>RT Rejected = Y</strong>.</li>
          <li>
            Click <strong>+ Repair &amp; Tracers</strong>. This creates a repair
            weld numbered <code>&lt;n&gt;R1</code> with the welder stamp and all
            NDE results cleared (tracked as a fresh weld), plus two tracer welds{" "}
            <code>&lt;n&gt;T1</code> and <code>&lt;n&gt;T2</code> that capture the
            original welder.
          </li>
          <li>
            The repair is tracked like any other weld. If the first repair is
            unsuccessful, use <strong>+ Repair</strong> again to create{" "}
            <code>&lt;n&gt;R2</code>, and add tracers as required.
          </li>
          <li>Repair and tracer welds are never count-omitted.</li>
        </ol>
      </div>

      <div className="card card-pad">
        <h3>Weld Status Colors</h3>
        <p className="muted">Set a weld's status in the weld editor to track its progress.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          <StatusBadge status="Required" />
          <StatusBadge status="Requested" />
          <StatusBadge status="Pending" />
          <StatusBadge status="PWHT" />
          <StatusBadge status="Clear" />
        </div>
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt><StatusBadge status="Required" /></dt><dd style={{ fontWeight: 400 }}>NDE is required but not yet requested.</dd>
          <dt><StatusBadge status="Requested" /></dt><dd style={{ fontWeight: 400 }}>NDE has been requested from the inspector.</dd>
          <dt><StatusBadge status="Pending" /></dt><dd style={{ fontWeight: 400 }}>Awaiting results or further action.</dd>
          <dt><StatusBadge status="PWHT" /></dt><dd style={{ fontWeight: 400 }}>Post-weld heat treatment in progress / required.</dd>
          <dt><StatusBadge status="Clear" /></dt><dd style={{ fontWeight: 400 }}>All requirements complete.</dd>
        </dl>
      </div>

      <div className="card card-pad">
        <h3>Markups &amp; the Tool Chest (weld map)</h3>
        <p>
          Redline the isometric right on the weld map: open a drawing, pick <b>✎ Markups</b>, and the Tool Chest docks on
          the left — like Bluebeam. <b>Redline</b> holds the drawing tools (text, callout, line, arrow, polyline, pen,
          rectangle, ellipse, revision cloud, highlight, dimension); <b>Piping</b> holds ready-made isometric symbols
          (flanges, valves, elbows, tees, reducers, olets, supports, field weld, tie-in, flow arrow…). Click a symbol,
          click the drawing, use <kbd>[</kbd> <kbd>]</kbd> to rotate it onto the run.
        </p>
        <ul>
          <li><b>Add to Tool Chest.</b> Draw something once (a flange sketched from lines, a standard note), right-click it → <i>Add to Tool Chest</i> → pick a set or make a new one. It reuses with one click, and sets are shared with the team.</li>
          <li><b>Drawing vs Properties mode.</b> Drawing mode places an exact copy (shape, size, text). Properties mode keeps only the look — color, width, dash — and you draw the shape each time. Symbols and groups are always Drawing mode.</li>
          <li><b>Select</b> (V) to move, resize, rotate; shift-click for several; <kbd>Ctrl+G</kbd> groups them into one symbol. Right-click for duplicate, lock, front/back, resolve, delete. <kbd>Ctrl+Z</kbd> undoes.</li>
          <li><b>Markups list</b> (☰) shows every redline on the sheet with who, when, subject and comment; mark them resolved as the work is done.</li>
          <li><b>Print</b> flattens the sheet — drawing, weld bubbles, legend and markups on every page — and opens the print dialog for the NDE hand-off. The arrow beside it opens or saves the same sheet as a PDF, or files it straight into the work order's quality package.</li>
        </ul>
      </div>

      <div className="card card-pad">
        <h3>Examination rules (the NDE table)</h3>
        <p>
          Every weld's required NDE % comes from a <b>rule set</b>: a coverage table of service / material / flange-class /
          code rows with shop and field percentages for radiography and for PT/MT, plus the vocabularies those rows use,
          the tie-in override, supplemental rules (large-bore spot RT, thick-wall UT), the coverage specs welders are judged
          against, progressive sampling and the facility default spec. The shipped default is EP 5-5-1 Rev 0.4 Table 4,
          value for value; an ASME B31.3 code-minimum template is included as a starting point for other organisations.
        </p>
        <ul>
          <li><b>Where.</b> Settings → Examination rules (administrators). Everyone can read the active rules; only an administrator saves or activates.</li>
          <li><b>Document control.</b> The active rule set is locked. Edit it, save under a new revision id, then activate. Every weld records the revision it was judged under, and history is never re-scored — only welds not yet examined can be re-evaluated, on request.</li>
          <li><b>Fail closed.</b> When a weld's drivers can't single out one row (say the class is blank where rows differ by class), the requirement is <i>unresolved</i> and names what is missing. It is never quietly the least-demanding row.</li>
          <li><b>Test a weld.</b> The editor has a panel to try any combination of drivers against the draft before it goes live.</li>
        </ul>
      </div>

      <div className="card card-pad">
        <h3>NDE Lots (ASME B31.3)</h3>
        <p>
          A <b>lot</b> is the population a welder's random-examination percentage is measured against. Without lots the
          denominator never stops growing: "5% of everything a welder ever did" can mean hundreds of welds before the next
          film is due. A lot bounds it — the shop convention is one every three months — and every weld belongs to exactly one.
        </p>
        <ul>
          <li><b>Receiving lot.</b> New welds land in it automatically. Pin a work order to a side lot when a job or crew should be judged on its own.</li>
          <li><b>Turnover.</b> At the expected length the lot stops taking welds (<i>Awaiting closeout</i>) and the next one opens — automatically, or you're asked at sign-in. A work order that is still active carries on in the new lot.</li>
          <li><b>Closeout.</b> Film keeps landing against the old lot. When every welder meets their coverage it closes itself. Closing <i>short</i> is allowed but never silent: a reason is required and what was owed is frozen on the lot record.</li>
          <li><b>Progressive sampling (341.3.4).</b> A rejected random examination adds two more of that welder's welds <i>from the same lot</i>; a reject among those adds two more; a third means every remaining weld of theirs in the lot.</li>
          <li><b>Welds to shoot.</b> The lot page picks random un-examined welds to cover what's owed and exports an RT request list. It's a helper, not a cage — re-roll anytime.</li>
        </ul>
      </div>

      <div className="card card-pad">
        <h3>Weld Map Markups &amp; Tool Chest</h3>
        <p>
          The ✎ tool on a weld map opens the <b>Tool Chest</b>: redline tools (text, callout, arrow, cloud, dimension…) and
          <b> isometric fittings</b> drawn the way they appear on an iso — a butt weld is a dot on the line, a socket weld is the
          socket face with its fillet dot, a threaded joint is a tick, a flange is a pair of lines.
        </p>
        <ul>
          <li><b>Categories:</b> Butt weld, Socket weld, Threaded, Flanged, Valves (pick the end type), Supports &amp; marks, plus your own sets.</li>
          <li><b>Aim first.</b> Choose the run axis (⟋ east–west, ⟍ north–south, │ vertical), the elbow arms or the branch direction on the compass, then click the fitting. <kbd>[</kbd> <kbd>]</kbd> rotate 30° at a time.</li>
          <li><b>One click places one.</b> The tool returns to Select so you can grab, resize, rotate or edit right away. Double-click a tool (or 📌) to keep it active.</li>
          <li><b>Reuse.</b> Right-click any markup → <b>Add to Tool Chest</b>. Drawing mode places an exact copy; Properties mode keeps only the look. Sets are shared with the team.</li>
          <li><b>Export.</b> ⭳ Weld map flattens the drawing, bubbles, legend and markups into a PDF, or files it straight into the work order's quality package.</li>
        </ul>
      </div>

      <div className="card card-pad">
        <h3>Key Concepts</h3>
        <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li><strong>Joint types:</strong> BW (butt weld), SW (socket weld), O-Let (branch/olet), Fillet, Other.</li>
          <li><strong>NDE levels:</strong> a line's spec sets the RT coverage (5, 10, 20, 25, 50 or 100%). Statistics can be filtered per level.</li>
          <li><strong>Weld inches</strong> are computed automatically as nominal size × π; wall thickness is looked up from the Pipe Table.</li>
          <li><strong>Count Omission:</strong> tick this to exclude a weld from every count and report (e.g. voided rows).</li>
          <li><strong>RT % = RT'd ÷ welds</strong>; <strong>Reject rate = rejected ÷ RT'd</strong> (the Client/TSA report uses rejected ÷ weld count).</li>
        </ul>
      </div>
    </div>
  );
}
