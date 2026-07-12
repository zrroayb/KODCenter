export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-logo compact" : "brand-logo"} aria-label="CRT Desk">
      <span className="crt-logo-mark" aria-hidden="true">
        <span className="crt-logo-candle" />
      </span>
      {!compact && (
        <span className="brand-logo-copy">
          <strong>CRT <b>Desk</b></strong>
          <small>Tradebot</small>
        </span>
      )}
    </div>
  );
}
