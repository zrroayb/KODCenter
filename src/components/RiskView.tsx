import { useMemo, useState } from "react";
import type { MarketSymbol, TradingSignal } from "../lib/ict/types";
import { defaultAccountModel, type AccountModel } from "../lib/risk/accountModel";
import { calculatePositionSize } from "../lib/risk/positionSizing";

export function RiskView({ signal }: { signal?: TradingSignal }) {
  const [account, setAccount] = useState<AccountModel>(defaultAccountModel);
  const [symbol, setSymbol] = useState<MarketSymbol>(signal?.symbol ?? "NAS100");
  const [entry, setEntry] = useState(signal?.plan.entry ?? 100);
  const [stopLoss, setStopLoss] = useState(signal?.plan.stopLoss ?? 95);
  const [target, setTarget] = useState(signal?.plan.targets[0] ?? 110);
  const result = useMemo(() => calculatePositionSize({ account, symbol, entry, stopLoss, target }), [account, symbol, entry, stopLoss, target]);

  return (
    <section className="risk-layout">
      <article className="panel">
        <header className="panel-head">
          <div>
            <span className="eyebrow">Risk</span>
            <h2>Position sizing</h2>
          </div>
          <span className="badge">Sadece memory</span>
        </header>
        <div className="form-grid">
          <label>Symbol<select value={symbol} onChange={(event) => setSymbol(event.target.value as MarketSymbol)}><option>XAUUSD</option><option>NAS100</option><option>EURUSD</option><option>GBPUSD</option><option>USDJPY</option><option>AUDUSD</option><option>USDCHF</option><option>BTCUSD</option><option>ETHUSD</option><option>XRPUSD</option><option>BNBUSD</option><option>SOLUSD</option></select></label>
          <label>Account size<input type="number" value={account.accountSize} onChange={(event) => setAccount({ ...account, accountSize: Number(event.target.value) })} /></label>
          <label>Risk %<input type="number" step="0.1" value={account.riskPerTradePct} onChange={(event) => setAccount({ ...account, riskPerTradePct: Number(event.target.value) })} /></label>
          <label>Max günlük loss %<input type="number" step="0.1" value={account.maxDailyLossPct} onChange={(event) => setAccount({ ...account, maxDailyLossPct: Number(event.target.value) })} /></label>
          <label>Max trade / gün<input type="number" value={account.maxTradesPerDay} onChange={(event) => setAccount({ ...account, maxTradesPerDay: Number(event.target.value) })} /></label>
          <label>Minimum RR<input type="number" step="0.1" value={account.minimumRR} onChange={(event) => setAccount({ ...account, minimumRR: Number(event.target.value) })} /></label>
          <label>Entry<input type="number" value={entry} onChange={(event) => setEntry(Number(event.target.value))} /></label>
          <label>Stop loss<input type="number" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} /></label>
          <label>Target<input type="number" value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Risk çıktısı</h2><span className="badge">{result.approximate ? "Approx" : "Exact"}</span></header>
        <div className="metric-grid">
          <div><span>Risk amount</span><strong>{result.riskAmount.toFixed(2)}</strong></div>
          <div><span>Position size</span><strong>{result.positionSize.toFixed(4)}</strong></div>
          <div><span>Olası loss</span><strong>{result.potentialLoss.toFixed(2)}</strong></div>
          <div><span>Olası gain</span><strong>{result.potentialGain.toFixed(2)}</strong></div>
          <div><span>RR</span><strong>1:{result.rr.toFixed(2)}</strong></div>
          <div><span>Risk distance</span><strong>{result.riskDistance.toFixed(5)}</strong></div>
        </div>
        <ul className="warning-list">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </article>
    </section>
  );
}
