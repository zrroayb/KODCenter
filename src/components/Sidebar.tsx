import { BarChart3, CandlestickChart, ScanSearch, Settings, ScrollText } from "lucide-react";
import type { ComponentType } from "react";
import type { ViewId } from "../App";

const ITEMS: Array<{ id: ViewId; label: string; caption: string; icon: ComponentType<{ size?: number }> }> = [
  { id: "scanner", label: "Bugün", caption: "Radar", icon: ScanSearch },
  { id: "charts", label: "Chart", caption: "Plan ekranı", icon: CandlestickChart },
  { id: "records", label: "Kayıtlar", caption: "Not & test", icon: ScrollText },
  { id: "settings", label: "Ayarlar", caption: "Kurallar", icon: Settings }
];

export function Sidebar({ activeView, onChange }: { activeView: ViewId; onChange: (view: ViewId) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <span className="brand-mark"><BarChart3 size={22} /></span>
        <div>
          <strong>Tradebot</strong>
          <span>ICT karar masası</span>
        </div>
      </div>
      <nav>
        {ITEMS.map((item) => {
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
        <span>KOD</span>
        <strong>Watch + Ready</strong>
      </div>
    </aside>
  );
}
