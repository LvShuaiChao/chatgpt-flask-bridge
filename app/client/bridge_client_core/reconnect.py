from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ReconnectPolicy:
    max_attempts: int = 5
    base_interval_sec: float = 1.0
    max_interval_sec: float = 30.0
    _attempts: int = field(default=0, init=False)
    _stopped: bool = field(default=False, init=False)

    def stop(self) -> None:
        self._stopped = True
        logger.info("[BRIDGE_CLIENT_RECONNECT][STOP] user_or_page_closed")

    def reset(self) -> None:
        self._attempts = 0
        self._stopped = False

    def should_retry(self) -> bool:
        if self._stopped:
            return False
        return self._attempts < self.max_attempts

    def next_delay_sec(self) -> float:
        if not self.should_retry():
            return 0.0
        delay = min(
            self.max_interval_sec,
            self.base_interval_sec * (2 ** self._attempts),
        )
        self._attempts += 1
        logger.info(
            "[BRIDGE_CLIENT_RECONNECT][SCHEDULE] attempt=%s delay_sec=%.2f",
            self._attempts,
            delay,
        )
        return delay

    def wait_before_retry(self) -> bool:
        delay = self.next_delay_sec()
        if delay <= 0:
            logger.warning("[BRIDGE_CLIENT_RECONNECT][FAILED] max_attempts_reached")
            return False
        time.sleep(delay)
        return True
