import type { Killzone } from "../ict/types";
import { sessionWindows } from "../session/sessionClock";

export function buildKillzoneContext(timestamp: number): Killzone[] {
  const date = new Date(timestamp);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  // Windows can wrap past midnight UTC (Asia): start > end means "evening through morning".
  const zones = sessionWindows(timestamp).map((zone) => ({
    ...zone,
    active: zone.startHourUtc <= zone.endHourUtc
      ? hour >= zone.startHourUtc && hour < zone.endHourUtc
      : hour >= zone.startHourUtc || hour < zone.endHourUtc
  }));
  if (zones.some((zone) => zone.active)) return zones;
  return [...zones, { name: "Outside", active: true, startHourUtc: 0, endHourUtc: 0 }];
}
