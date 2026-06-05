from __future__ import annotations


def sma(values: list[float], period: int) -> list[float | None]:
    _validate_period(period)
    result: list[float | None] = []
    running_sum = 0.0

    for index, value in enumerate(values):
        running_sum += value
        if index >= period:
            running_sum -= values[index - period]
        if index + 1 >= period:
            result.append(running_sum / period)
        else:
            result.append(None)

    return result


def ema(values: list[float], period: int) -> list[float | None]:
    _validate_period(period)
    result: list[float | None] = [None] * len(values)
    if len(values) < period:
        return result

    multiplier = 2 / (period + 1)
    previous = sum(values[:period]) / period
    result[period - 1] = previous

    for index in range(period, len(values)):
        previous = (values[index] - previous) * multiplier + previous
        result[index] = previous

    return result


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    _validate_period(period)
    result: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return result

    gains: list[float] = []
    losses: list[float] = []
    for index in range(1, period + 1):
        change = values[index] - values[index - 1]
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    result[period] = _rsi_from_averages(avg_gain, avg_loss)

    for index in range(period + 1, len(values)):
        change = values[index] - values[index - 1]
        gain = max(change, 0)
        loss = abs(min(change, 0))
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period
        result[index] = _rsi_from_averages(avg_gain, avg_loss)

    return result


def macd(
    values: list[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    _validate_period(fast)
    _validate_period(slow)
    _validate_period(signal)
    if fast >= slow:
        raise ValueError("MACD fast period must be lower than slow period")

    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    line: list[float | None] = []
    compact_line: list[float] = []

    for fast_value, slow_value in zip(fast_ema, slow_ema):
        if fast_value is None or slow_value is None:
            line.append(None)
        else:
            value = fast_value - slow_value
            line.append(value)
            compact_line.append(value)

    compact_signal = ema(compact_line, signal)
    signal_line: list[float | None] = []
    compact_index = 0
    for value in line:
        if value is None:
            signal_line.append(None)
        else:
            signal_line.append(compact_signal[compact_index])
            compact_index += 1

    histogram = [
        None if line_value is None or signal_value is None else line_value - signal_value
        for line_value, signal_value in zip(line, signal_line)
    ]
    return line, signal_line, histogram


def atr(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 14,
) -> list[float | None]:
    _validate_period(period)
    if not (len(highs) == len(lows) == len(closes)):
        raise ValueError("highs, lows, and closes must have the same length")

    true_ranges: list[float] = []
    for index, high in enumerate(highs):
        low = lows[index]
        if index == 0:
            true_ranges.append(high - low)
        else:
            previous_close = closes[index - 1]
            true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))

    result: list[float | None] = [None] * len(true_ranges)
    if len(true_ranges) < period:
        return result

    previous = sum(true_ranges[:period]) / period
    result[period - 1] = previous
    for index in range(period, len(true_ranges)):
        previous = ((previous * (period - 1)) + true_ranges[index]) / period
        result[index] = previous

    return result


def crossed_above(
    previous_left: float | None,
    previous_right: float | None,
    current_left: float | None,
    current_right: float | None,
) -> bool:
    if None in (previous_left, previous_right, current_left, current_right):
        return False
    return previous_left <= previous_right and current_left > current_right


def crossed_below(
    previous_left: float | None,
    previous_right: float | None,
    current_left: float | None,
    current_right: float | None,
) -> bool:
    if None in (previous_left, previous_right, current_left, current_right):
        return False
    return previous_left >= previous_right and current_left < current_right


def _rsi_from_averages(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0
    relative_strength = avg_gain / avg_loss
    return 100 - (100 / (1 + relative_strength))


def _validate_period(period: int) -> None:
    if period <= 0:
        raise ValueError("period must be positive")
