export function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

export function formatR(value: number): string {
  return `1:${value.toFixed(2)}`;
}
