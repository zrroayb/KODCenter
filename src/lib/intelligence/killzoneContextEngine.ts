import type { Killzone } from "../ict/types";
import { sessionWindows } from "../session/sessionClock";

const WINDOWS: Killzone[] = sessionWindows();

export function buildKillzoneContext(timestamp: number): Killzone[] {
  const date = new Date(timestamp);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const zones = WINDOWS.map((zone) => ({
    ...zone,
    active: hour >= zone.startHourUtc && hour < zone.endHourUtc
  }));
  if (zones.some((zone) => zone.active)) return zones;
  return [...zones, { name: "Outside", active: true, startHourUtc: 0, endHourUtc: 0 }];
}
