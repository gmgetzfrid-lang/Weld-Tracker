import { useId } from "react";

/**
 * The SENTRIX mark: a gradient diamond (blue → green → gold) carrying a white
 * four-point compass star. Drawn as inline SVG so it's crisp at any size and
 * reads on both light and dark backgrounds.
 */
export function SentrixMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="SENTRIX"
    >
      <defs>
        <linearGradient id={id} x1="16" y1="16" x2="84" y2="84" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1E90FF" />
          <stop offset="0.55" stopColor="#00C78C" />
          <stop offset="1" stopColor="#FFD700" />
        </linearGradient>
      </defs>
      <rect
        x="22" y="22" width="56" height="56" rx="11"
        transform="rotate(45 50 50)"
        fill={`url(#${id})`}
      />
      <path
        d="M50 13 L56 44 L87 50 L56 56 L50 87 L44 56 L13 50 L44 44 Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** The SENTRIX wordmark, optionally with the "Assurance Console" tagline. */
export function SentrixWordmark({ tagline = false }: { tagline?: boolean }) {
  return (
    <span className="brand-lockup">
      <span className="brand-word">SENTRIX</span>
      {tagline && <span className="brand-tag">Assurance Console</span>}
    </span>
  );
}

/** Mark + wordmark together (used on the login and change-password screens). */
export function SentrixLockup({ size = 56 }: { size?: number }) {
  return (
    <div className="brand-hero">
      <SentrixMark size={size} />
      <div className="brand-hero-text">
        <span className="brand-hero-word">SENTRIX</span>
        <span className="brand-hero-tag">Assurance Console</span>
      </div>
    </div>
  );
}
