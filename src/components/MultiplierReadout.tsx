export function MultiplierReadout({ hundredths, busted, live, hint }: { hundredths: number; busted: boolean; live?: boolean; hint?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="text-center">
        <div
          className={`font-display-multiplier text-display-multiplier tracking-tighter ${live ? "multiplier-pulse" : ""} ${
            busted ? "neon-glow-bust text-error" : "neon-glow text-primary"
          }`}
        >
          {(hundredths / 100).toFixed(2)}x
        </div>
        {hint && (
          <div
            className={`mt-4 inline-block rounded-full border px-4 py-1 backdrop-blur-md ${
              live ? "border-primary bg-primary/20" : "border-outline-variant bg-surface-container/40"
            }`}
          >
            <span className={`font-label-mono text-label-mono ${live ? "text-primary" : "text-on-surface-variant"}`}>{hint}</span>
          </div>
        )}
      </div>
    </div>
  )
}
