import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

const GITHUB_REPO = "brianwcline/nextdialog";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map(Number);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const currentVersion = await getVersion();
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
      },
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    const latestTag: string = data.tag_name ?? "";
    const latestVersion = latestTag.replace(/^v/, "");
    const downloadUrl: string = data.html_url ?? `https://github.com/${GITHUB_REPO}/releases`;

    if (compareVersions(currentVersion, latestVersion)) {
      return { currentVersion, latestVersion, downloadUrl };
    }
    return null;
  } catch {
    return null;
  }
}

export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check on mount (slight delay to not block startup)
    const initialTimer = setTimeout(() => {
      checkForUpdate().then(setUpdate);
    }, 5000);

    // Re-check periodically
    const interval = setInterval(() => {
      checkForUpdate().then(setUpdate);
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  return {
    update: dismissed ? null : update,
    dismiss: () => setDismissed(true),
  };
}
