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
