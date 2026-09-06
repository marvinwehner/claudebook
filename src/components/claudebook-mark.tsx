/**
 * The Claudebook mark: a book seen from above — cover and endpaper — which is
 * also a C.
 *
 * Two-tone by construction. The cover follows `currentColor`, so the mark takes
 * the colour of whatever it is placed on and works on either theme unchanged;
 * the endpaper is always the accent.
 *
 * `docs/logo.svg` and `docs/logo-dark.svg` are this same geometry with the
 * colours baked in, for the README — GitHub has no CSS to inherit. Change them
 * together.
 */
export function ClaudebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <path
        d="M46.31 9.1 A27 27 0 1 0 46.31 54.9 L41.54 47.26 A18 18 0 1 1 41.54 16.74 Z"
        fill="currentColor"
      />
      <path
        d="M38.79 18.07 A15.5 15.5 0 1 0 38.79 45.93 L35.95 40.09 A9 9 0 1 1 35.95 23.91 Z"
        className="fill-accent"
      />
    </svg>
  );
}
