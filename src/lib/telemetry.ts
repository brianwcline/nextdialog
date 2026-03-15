import { invoke } from "@tauri-apps/api/core";

export function trackEvent(
  eventName: string,
  featureId: string,
  properties?: Record<string, unknown>,
  sessionId?: string,
) {
  invoke("track_event", {
    eventName,
    featureId,
    properties: properties ?? null,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}
