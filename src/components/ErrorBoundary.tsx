import { Component, type ErrorInfo, type ReactNode } from "react";

// Last line of defence: any render/effect error used to unmount the whole app (blank screen).
// Show a recovery card instead. "Clear cache" drops only rebuildable histories (session /
// Silver Bullet / alert caches) — the user's journal and rules are kept.
const KEEP_KEYS = new Set(["tradebot.localJournal.v1", "tradebot-user-rules-v1"]);

function clearRebuildableStorage() {
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && !KEEP_KEYS.has(key) && key.startsWith("tradebot")) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Storage blocked: a plain reload is all we can do.
  }
}

type State = { error?: Error };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("KODCenter render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-boundary__card">
          <h2>Ekran yüklenirken bir hata oldu</h2>
          <p>Veriler güvende — journal ve kuralların silinmez.</p>
          <code>{error.name}: {error.message}</code>
          <div className="error-boundary__actions">
            <button type="button" className="primary-btn" onClick={() => window.location.reload()}>Yenile</button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => { clearRebuildableStorage(); window.location.reload(); }}
            >
              Önbelleği temizle ve yenile
            </button>
          </div>
        </div>
      </div>
    );
  }
}
