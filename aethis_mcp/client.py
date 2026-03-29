"""Thin HTTP client for the Aethis developer API (MCP-server edition)."""

from __future__ import annotations

import os
from typing import Any

import httpx


class AethisAPIError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}: {detail}")


class AethisClient:
    """Synchronous client for the Aethis decision and project endpoints."""

    def __init__(self) -> None:
        api_key = os.environ.get("AETHIS_API_KEY", "")
        base_url = os.environ.get("AETHIS_BASE_URL", "https://api.aethis.ai")
        if not api_key:
            raise AethisAPIError(401, "AETHIS_API_KEY environment variable is not set")
        self._client = httpx.Client(
            base_url=base_url,
            headers={"X-API-Key": api_key},
            timeout=60.0,
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        resp = self._client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text or f"HTTP {resp.status_code}"
            raise AethisAPIError(resp.status_code, detail)
        return resp.json()

    # -- Decision API --

    def decide(self, bundle_id: str, field_values: dict) -> dict:
        return self._request("POST", "/api/v1/public/decide", json={
            "bundle_id": bundle_id,
            "field_values": field_values,
        })

    def get_schema(self, bundle_id: str) -> dict:
        return self._request("GET", f"/api/v1/public/bundles/{bundle_id}/schema")

    def explain(self, bundle_id: str) -> dict:
        return self._request("GET", f"/api/v1/public/bundles/{bundle_id}/explain")

    # -- Projects API --

    def list_projects(self) -> list[dict]:
        return self._request("GET", "/api/v1/public/projects/")

    def get_status(self, project_id: str) -> dict:
        return self._request("GET", f"/api/v1/public/projects/{project_id}/status")

    def generate(self, project_id: str) -> dict:
        return self._request("POST", f"/api/v1/public/projects/{project_id}/generate")
