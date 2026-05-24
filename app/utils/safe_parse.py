"""Safe parsing helpers for UI / bridge field access."""
from __future__ import annotations

from typing import Any


def safe_float_field(data: Any, field: str, default: float = 0.0) -> float:
    mapping = data if isinstance(data, dict) else {}
    raw = mapping.get(field) if mapping else None
    if raw in (None, ""):
        raw = default
    try:
        return float(raw)
    except (TypeError, ValueError) as error:
        print(
            "[SAFE_PARSE][FLOAT_FIELD_FALLBACK] "
            f"field={field} value={raw!r} default={default!r} "
            f"error_type={type(error).__name__} error={error}",
            flush=True,
        )
        try:
            return float(default)
        except (TypeError, ValueError) as nested_error:
            print(
                "[SAFE_PARSE][FLOAT_DEFAULT_INVALID] "
                f"field={field} default={default!r} "
                f"error_type={type(nested_error).__name__} error={nested_error}",
                flush=True,
            )
            return 0.0
