// A fixed locale, not the runtime default: the server's default is en-US and the
// browser's is the visitor's own, so `undefined` here renders "Sep 6, 2026" into the
// HTML and "6 Sept 2026" on hydration. The UI is English-only, so pin it.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
