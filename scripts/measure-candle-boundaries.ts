// Measures Yahoo's raw daily/hourly bar timestamps so the daily bucket can be anchored to the
// NY 17:00 close with evidence (item 10, 2026-09-26). Run: npx tsx scripts/measure-candle-boundaries.ts
// Prints, per symbol, the last daily stamps in UTC and New York time, and which UTC hours the
// hourly bars of the latest Monday cover (first bar = when that trade date's session opened).
const SYMBOLS = ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "GC=F", "NQ=F"];
const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

async function chart(symbol: string, interval: string, range: string): Promise<number[]> {
  const response = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includePrePost=false`, { headers: { "user-agent": "Mozilla/5.0" } });
  const body = await response.json() as { chart?: { result?: Array<{ timestamp?: number[] }> } };
  return body.chart?.result?.[0]?.timestamp ?? [];
}

async function run() {
  for (const symbol of SYMBOLS) {
    const daily = await chart(symbol, "1d", "15d");
    const hourly = await chart(symbol, "1h", "5d");
    console.log(`\n${symbol}`);
    for (const stamp of daily.slice(-6)) {
      const time = stamp * 1000;
      console.log(`  1d ${new Date(time).toISOString()}  NY ${ny.format(time)}`);
    }
    const hours = hourly.map((stamp) => new Date(stamp * 1000));
    const firstOfEachDay = new Map<string, Date>();
    for (const date of hours) {
      const key = date.toISOString().slice(0, 10);
      if (!firstOfEachDay.has(key)) firstOfEachDay.set(key, date);
    }
    for (const [day, first] of firstOfEachDay) console.log(`  1h first bar on ${day}: ${first.toISOString()} (NY ${ny.format(first.getTime())})`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
