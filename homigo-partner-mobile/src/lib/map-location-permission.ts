/**
 * What starts the map's location watch, and whether that start may show the permission prompt.
 * The prompt is a system activity that pauses the app even when permission is already granted, so a
 * start triggered by the app returning to the foreground must only check — otherwise every prompt
 * triggers the next one (X-75, emulator 2026-09-29).
 */
export type MapLocationTrigger = "mount" | "retry" | "resume";

export function mapPermissionCall(trigger: MapLocationTrigger): "request" | "check" {
  return trigger === "resume" ? "check" : "request";
}
