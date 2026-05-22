"""HTTP 路由注册入口（默认仅 core；外部 API 按需懒加载）。"""
from __future__ import annotations

from app.server.route_flags import enable_external_api


def print_registered_routes():
    from app.server.runtime_state import print_registered_routes as _print

    return _print()


def register_routes(app) -> None:
    """Attach HTTP routes to *app*."""
    from app.server import core_routes

    core_routes.register_core_routes(app)
    if not enable_external_api():
        return
    from app.server import cursor_routes, external_routes, job_routes

    external_routes.register_external_routes(app)
    cursor_routes.register_cursor_routes(app)
    job_routes.register_job_routes(app)
