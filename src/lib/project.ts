/**
 * Derive a project slug from a session's working directory.
 *
 * Used by the smart layout engine to group "related sessions" (Focus mode
 * keeps sessions in the same project close together when one is focused).
 *
 * Convention: the first path segment under `/dev/` is the project. If the
 * directory isn't under `/dev/`, fall back to the basename.
 *
 * Examples:
 *   ~/dev/substrate                  → "substrate"
 *   ~/dev/nextdialog/product-manager → "nextdialog"
 *   ~/dev/carehub/carehub-therapy    → "carehub"
 *   /opt/something                   → "something"
 *   /                                → null
 */
export function deriveProject(workingDir: string): string | null {
  if (!workingDir) return null;

  // Strip trailing slash (except the root "/")
  let normalized = workingDir;
  if (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  // Look for /dev/ segment — first segment after it is the project slug.
  // Matches both ~/dev/foo and /Users/someone/dev/foo.
  const devIndex = normalized.indexOf("/dev/");
  if (devIndex !== -1) {
    const afterDev = normalized.slice(devIndex + 5); // length of "/dev/"
    const firstSegment = afterDev.split("/")[0];
    if (firstSegment) return firstSegment;
  }

  // Fall back to the basename.
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1] || null;
}
