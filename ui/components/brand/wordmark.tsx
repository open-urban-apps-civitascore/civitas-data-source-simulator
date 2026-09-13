// Copied from the marketplace click-dummy.
const PARTS = ["OPEN", "URBAN", "APPS"] as const;

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-mono font-medium tracking-[0.12em] ${className}`}>
      {PARTS.map((part, index) => (
        <span key={part}>
          {index > 0 ? (
            <span aria-hidden="true" style={{ color: "var(--logo-frame)" }}>
              /
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}
