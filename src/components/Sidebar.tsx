import { Bot, CandlestickChart, Crosshair, Gauge, History, ScanSearch, Settings, ScrollText, TimerReset } from "lucide-react";
import type { ComponentType } from "react";
import type { ViewId } from "../App";
import { BrandLogo } from "./BrandLogo";

export const NAV_ITEMS: Array<{ id: ViewId; label: string; caption: string; icon: ComponentType<{ size?: number }>; mobile?: boolean }> = [
  { id: "dashboard", label: "Bugün", caption: "Karar", icon: Gauge, mobile: true },
  { id: "charts", label: "Chart", caption: "Plan", icon: CandlestickChart, mobile: true },
  { id: "scanner", label: "Tara", caption: "Radar", icon: ScanSearch, mobile: true },
  { id: "sessionSetups", label: "Session", caption: "CRT akışı", icon: TimerReset, mobile: true },
  { id: "silverBullet", label: "Silver", caption: "NY 10-11", icon: Crosshair, mobile: true },
  { id: "backtest", label: "Replay", caption: "Test", icon: History, mobile: true },
  { id: "journal", label: "Notlar", caption: "Kayıt", icon: ScrollText, mobile: true },
  { id: "ai", label: "AI", caption: "Koç", icon: Bot },
  { id: "settings", label: "Ayar", caption: "Kural", icon: Settings }
];

export function Sidebar({ activeView, onChange }: { activeView: ViewId; onChange: (view: ViewId) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <BrandLogo />
      </div>
      <nav>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              aria-label={`${item.label} ${item.caption}`}
              className={activeView === item.id ? "active" : ""}
              onClick={() => onChange(item.id)}
              type="button"
            >
              <Icon size={17} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.caption}</small>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-note">
        <span>Mod</span>
        <strong>Basit</strong>
      </div>
    </aside>
  );
}
