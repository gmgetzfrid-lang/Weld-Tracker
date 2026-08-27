export function Stepper({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <div className="stepper">
      {steps.map((label, i) => (
        <div
          key={label}
          className={`step ${i === current ? "active" : ""} ${i < current ? "done" : ""}`}
        >
          <div className="step-dot">{i < current ? "✓" : i + 1}</div>
          <div className="step-label">{label}</div>
          {i < steps.length - 1 && <div className="step-bar" />}
        </div>
      ))}
    </div>
  );
}

export function Coach({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="coach">
      <span className="coach-ico">💡</span>
      <div>
        <b>{title}</b>
        <div style={{ marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}
