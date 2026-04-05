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

    _LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"}

    def __init__(self) -> None:
        api_key = os.environ.get("AETHIS_API_KEY", "")
        base_url = os.environ.get("AETHIS_BASE_URL", "https://api.aethis.ai")
        if not api_key:
            raise AethisAPIError(401, "AETHIS_API_KEY environment variable is not set")
        self._validate_base_url(base_url)
        self._client = httpx.Client(
            base_url=base_url,
            headers={"X-API-Key": api_key},
            timeout=httpx.Timeout(connect=5, read=25, write=10, pool=5),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            verify=True,
        )

    @classmethod
    def _validate_base_url(cls, url: str) -> None:
        """Reject http:// URLs unless targeting localhost."""
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if parsed.scheme == "http" and parsed.hostname not in cls._LOCAL_HOSTS:
            raise AethisAPIError(
                400,
                f"Refusing to use HTTP for remote host '{parsed.hostname}'. "
                "Use HTTPS or target localhost for local development.",
            )

    def close(self) -> None:
        self._client.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        resp = self._client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except (ValueError, KeyError):
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

    # -- Authoring API --

    def create_project(self, name: str, section_id: str, domain: str = "") -> dict:
        return self._request("POST", "/api/v1/public/projects/", json={
            "name": name,
            "section_id": section_id,
            "domain": domain,
        })

    def upload_source_text(self, project_id: str, filename: str, content: str) -> dict:
        """Upload source text as an in-memory file (no filesystem path needed)."""
        files = [("files", (filename, content.encode("utf-8"), "text/plain"))]
        return self._request("POST", f"/api/v1/public/projects/{project_id}/sources", files=files)

    def add_guidance(self, project_id: str, guidance_text: str) -> dict:
        return self._request("POST", f"/api/v1/public/projects/{project_id}/guidance", json={
            "guidance_text": guidance_text,
        })

    def add_tests(self, project_id: str, test_cases: list[dict]) -> dict:
        return self._request("POST", f"/api/v1/public/projects/{project_id}/tests", json={
            "test_cases": test_cases,
        })

    def run_tests(self, project_id: str) -> dict:
        return self._request("POST", f"/api/v1/public/projects/{project_id}/test-run")

    def publish(self, project_id: str) -> dict:
        return self._request("POST", f"/api/v1/public/projects/{project_id}/publish")

    def generate_and_test(self, project_id: str) -> dict:
        """Generate rules and run tests. May take 60-120s."""
        return self._request(
            "POST",
            f"/api/v1/public/projects/{project_id}/generate-and-test",
            timeout=httpx.Timeout(connect=5, read=180, write=10, pool=5),
        )
