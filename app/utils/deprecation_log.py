"""低频兼容/迁移路径的统一观察日志。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def log_deprecated_hit(
    name: str,
    reason: str = "",
    replacement: str = "",
    caller: str = "",
) -> None:
    parts = [
        "[DEPRECATED_HIT]",
        f"name={name or '-'}",
    ]
    if reason:
        parts.append(f"reason={reason}")
    if replacement:
        parts.append(f"replacement={replacement}")
    if caller:
        parts.append(f"caller={caller}")
    logger.warning(" ".join(parts))


def log_migration_hit(
    name: str,
    old: str = "",
    new: str = "",
    reason: str = "",
) -> None:
    parts = [
        "[MIGRATION_HIT]",
        f"name={name or '-'}",
    ]
    if old:
        parts.append(f"old={old}")
    if new:
        parts.append(f"new={new}")
    if reason:
        parts.append(f"reason={reason}")
    logger.info(" ".join(parts))
