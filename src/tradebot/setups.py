from __future__ import annotations

import operator
from dataclasses import dataclass
from typing import Any, Callable

from tradebot.config import ConfigError, SetupConfig
from tradebot.indicators import crossed_above, crossed_below, ema, macd, rsi, sma
from tradebot.models import Candle


Comparison = Callable[[float, float], bool]


COMPARISONS: dict[str, Comparison] = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
}


@dataclass(frozen=True)
class Evaluation:
    matched: bool
    details: list[str]


class SetupEvaluator:
    def evaluate(self, setup: SetupConfig, candles: list[Candle]) -> Evaluation:
        if len(candles) < 3:
            return Evaluation(False, ["not enough candles"])

        return self._evaluate_group(setup.conditions, candles)

    def _evaluate_group(self, group: dict[str, Any], candles: list[Candle]) -> Evaluation:
        if "all" in group:
            evaluations = [self._evaluate_node(item, candles) for item in group["all"]]
            return Evaluation(
                all(item.matched for item in evaluations),
                [detail for item in evaluations for detail in item.details],
            )
        if "any" in group:
            evaluations = [self._evaluate_node(item, candles) for item in group["any"]]
            return Evaluation(
                any(item.matched for item in evaluations),
                [detail for item in evaluations for detail in item.details],
            )
        return self._evaluate_condition(group, candles)

    def _evaluate_node(self, node: dict[str, Any], candles: list[Candle]) -> Evaluation:
        if not isinstance(node, dict):
            raise ConfigError("condition nodes must be objects")
        if "all" in node or "any" in node:
            return self._evaluate_group(node, candles)
        return self._evaluate_condition(node, candles)

    def _evaluate_condition(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        indicator = condition.get("indicator")
        if indicator == "ema_cross":
            return self._ema_cross(condition, candles)
        if indicator == "rsi":
            return self._rsi(condition, candles)
        if indicator == "price_vs_ema":
            return self._price_vs_ema(condition, candles)
        if indicator == "volume_spike":
            return self._volume_spike(condition, candles)
        if indicator == "macd_cross":
            return self._macd_cross(condition, candles)
        raise ConfigError(f"unsupported indicator: {indicator!r}")

    def _ema_cross(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        fast = int(condition.get("fast", 9))
        slow = int(condition.get("slow", 21))
        direction = str(condition.get("direction", "bullish"))
        closes = [candle.close for candle in candles]
        fast_ema = ema(closes, fast)
        slow_ema = ema(closes, slow)

        if direction == "bullish":
            matched = crossed_above(fast_ema[-2], slow_ema[-2], fast_ema[-1], slow_ema[-1])
        elif direction == "bearish":
            matched = crossed_below(fast_ema[-2], slow_ema[-2], fast_ema[-1], slow_ema[-1])
        else:
            raise ConfigError("ema_cross.direction must be bullish or bearish")

        fast_value = _fmt(fast_ema[-1])
        slow_value = _fmt(slow_ema[-1])
        status = "OK" if matched else "NO"
        return Evaluation(matched, [f"{status} EMA cross {direction}: EMA{fast}={fast_value}, EMA{slow}={slow_value}"])

    def _rsi(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        period = int(condition.get("period", 14))
        comparison_name = str(condition.get("operator", ">="))
        threshold = float(condition["value"])
        comparison = _comparison(comparison_name)
        closes = [candle.close for candle in candles]
        values = rsi(closes, period)
        current = values[-1]
        matched = current is not None and comparison(current, threshold)
        status = "OK" if matched else "NO"
        return Evaluation(matched, [f"{status} RSI{period}: {_fmt(current)} {comparison_name} {_fmt(threshold)}"])

    def _price_vs_ema(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        period = int(condition.get("period", 200))
        relation = str(condition.get("relation", "above"))
        closes = [candle.close for candle in candles]
        values = ema(closes, period)
        current_ema = values[-1]
        close = candles[-1].close

        if current_ema is None:
            matched = False
        elif relation == "above":
            matched = close > current_ema
        elif relation == "below":
            matched = close < current_ema
        else:
            raise ConfigError("price_vs_ema.relation must be above or below")

        status = "OK" if matched else "NO"
        return Evaluation(matched, [f"{status} price {relation} EMA{period}: close={_fmt(close)}, EMA={_fmt(current_ema)}"])

    def _volume_spike(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        lookback = int(condition.get("lookback", 20))
        multiplier = float(condition.get("multiplier", 1.5))
        volumes = [candle.volume for candle in candles]
        averages = sma(volumes[:-1], lookback)
        baseline = averages[-1] if averages else None
        current = volumes[-1]
        matched = baseline is not None and current >= baseline * multiplier
        status = "OK" if matched else "NO"
        baseline_text = _fmt(None if baseline is None else baseline * multiplier)
        return Evaluation(matched, [f"{status} volume spike: volume={_fmt(current)}, threshold={baseline_text}"])

    def _macd_cross(self, condition: dict[str, Any], candles: list[Candle]) -> Evaluation:
        fast = int(condition.get("fast", 12))
        slow = int(condition.get("slow", 26))
        signal = int(condition.get("signal", 9))
        direction = str(condition.get("direction", "bullish"))
        closes = [candle.close for candle in candles]
        macd_line, signal_line, _ = macd(closes, fast=fast, slow=slow, signal=signal)

        if direction == "bullish":
            matched = crossed_above(macd_line[-2], signal_line[-2], macd_line[-1], signal_line[-1])
        elif direction == "bearish":
            matched = crossed_below(macd_line[-2], signal_line[-2], macd_line[-1], signal_line[-1])
        else:
            raise ConfigError("macd_cross.direction must be bullish or bearish")

        status = "OK" if matched else "NO"
        return Evaluation(matched, [f"{status} MACD cross {direction}: MACD={_fmt(macd_line[-1])}, signal={_fmt(signal_line[-1])}"])


def _comparison(name: str) -> Comparison:
    comparison = COMPARISONS.get(name)
    if comparison is None:
        raise ConfigError(f"unsupported operator: {name!r}")
    return comparison


def _fmt(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.6g}"

