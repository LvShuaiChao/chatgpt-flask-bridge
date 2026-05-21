from typing import Any


def float_ts(
    value: Any,
    default: float = 0.0,
    *,
    name: str = "",
    debug_log: bool = False,
    context: str = "",
    log_on_error: bool = False,
) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        if debug_log or log_on_error:
            log_context = context or name or "-"
            print(
                "[TIME_UTILS][FLOAT_TS_FALLBACK] "
                "function=float_ts "
                f"context={log_context} "
                f"value={value!r} "
                f"default={default!r} "
                f"error_type={type(error).__name__} "
                f"error={error}"
            )
        return default
