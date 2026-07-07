import { BarChart3, Bot, CandlestickChart, Gauge, History, ScanSearch, Settings, ScrollText } from "lucide-react";
import type { ComponentType } from "react";
import type { ViewId } from "../App";

export const NAV_ITEMS: Array<{ id: ViewId; label: string; caption: string; icon: ComponentType<{ size?: number }>; mobile?: boolean }> = [
  { id: "dashboard", label: "Dashboard", caption: "Today", icon: Gauge, mobile: true },
  { id: "charts", label: "Chart", caption: "Workspace", icon: CandlestickChart, mobile: true },
  { id: "scanner", label: "Scanner", caption: "Radar", icon: ScanSearch, mobile: true },
  { id: "backtest", label: "Backtest", caption: "Replay", icon: History },
  { id: "journal", label: "Journal", caption: "Trades", icon: ScrollText, mobile: true },
  { id: "ai", label: "AI", caption: "Coach", icon: Bot, mobile: true },
  { id: "settings", label: "Settings", caption: "Rules", icon: Settings }
];

export function Sidebar({ activeView, onChange }: { activeView: ViewId; onChange: (view: ViewId) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <span className="brand-mark"><BarChart3 size={22} /></span>
        <div>
          <strong>Finance AI</strong>
          <span>Trading workspace</span>
        </div>
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
        <span>Status</span>
        <strong>Decision first</strong>
      </div>
    </aside>
  );
}
