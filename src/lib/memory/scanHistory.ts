export type ScanHistoryItem = {
  time: number;
  symbol: string;
  strategyId: string;
  readySignals: number;
  rejectedSetups: number;
};

export type ScanHistory = ScanHistoryItem[];
