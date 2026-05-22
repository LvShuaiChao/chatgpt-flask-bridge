import pytest

from app.server.state import BridgeQueueFullError, MAX_OUTBOUND_QUEUE_SIZE


def test_bridge_queue_full_error_to_dict():
    err = BridgeQueueFullError(50, MAX_OUTBOUND_QUEUE_SIZE)
    payload = err.to_dict()
    assert payload["code"] == "queue_full"
    assert payload["queue_full"] is True
    assert payload["current_size"] == 50
    assert payload["max_size"] == MAX_OUTBOUND_QUEUE_SIZE
    assert "队列已满" in payload["suggestion"]
