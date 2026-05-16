"""Client for the Clawvisor API gateway."""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any

from gbrain.config import ClawvisorConfig


class ClawvisorError(Exception):
    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body
        super().__init__(f"Clawvisor API error {status}: {body}")


class ClawvisorClient:
    def __init__(self, config: ClawvisorConfig | None = None):
        self.config = config or ClawvisorConfig.from_env()

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        params: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> Any:
        url = f"{self.config.url}{path}"
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{url}?{qs}"

        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, headers=self.config.headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode()
                if raw:
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        return raw
                return None
        except urllib.error.HTTPError as e:
            raise ClawvisorError(e.code, e.read().decode()) from e

    # -- Health --

    def health(self) -> dict:
        return self._request("GET", "/health")

    # -- Catalog --

    def catalog(self, service: str | None = None) -> str:
        params = {"service": service} if service else None
        return self._request("GET", "/api/skill/catalog", params=params)

    # -- Tasks --

    def create_task(
        self,
        purpose: str,
        scopes: list[dict[str, Any]],
        wait: bool = True,
        timeout: int = 120,
    ) -> dict:
        params = {}
        if wait:
            params["wait"] = "true"
            params["timeout"] = str(timeout)
        body = {"purpose": purpose, "scopes": scopes}
        return self._request("POST", "/api/tasks", body=body, params=params, timeout=timeout + 10)

    def get_task(self, task_id: str, wait: bool = False, timeout: int = 120) -> dict:
        params = {}
        if wait:
            params["wait"] = "true"
            params["timeout"] = str(timeout)
        return self._request("GET", f"/api/tasks/{task_id}", params=params, timeout=timeout + 10)

    def list_tasks(self) -> list[dict]:
        return self._request("GET", "/api/tasks")

    # -- Execute actions against services --

    def execute(
        self,
        task_id: str,
        service: str,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        body: dict[str, Any] = {
            "task_id": task_id,
            "service": service,
            "action": action,
        }
        if params:
            body["params"] = params
        return self._request("POST", "/api/gateway/execute", body=body)

    # -- Agent connection --

    def connect_agent(
        self,
        name: str = "gbrain",
        description: str = "GBrain Communication agent",
        wait: bool = True,
        timeout: int = 120,
    ) -> dict:
        params = {}
        if wait:
            params["wait"] = "true"
            params["timeout"] = str(timeout)
        body = {"name": name, "description": description}
        return self._request(
            "POST", "/api/agents/connect", body=body, params=params, timeout=timeout + 10
        )
