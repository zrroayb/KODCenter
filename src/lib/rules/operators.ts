export type NumericOperator = ">" | ">=" | "<" | "<=" | "==";

export function compare(left: number, operator: NumericOperator, right: number): boolean {
  switch (operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "==":
      return left === right;
  }
}
