"""
Iteration 3: Verifies the /api/gmail/sync 403 error surfacing improvement +
regression that /api/gmail/sync still returns 401 for a bogus token, and that
/api/ocr/order endpoint is present.

Two kinds of verification are used:
  * Live HTTP calls against the public preview URL (401 branch, ocr endpoint).
  * Static code inspection of /app/backend/server.py to confirm the 403 branch
    and the 502 wrapping branch exist with the expected content.  Reason:
    Google returns 401 for a garbage bearer, not 403, so we cannot cause the
    403 branch to fire without a real revoked token from a project that has
    the Gmail API disabled.  Inspecting the code path is the deterministic
    check requested in the review.
"""
import os
import re
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

SERVER_PY = Path("/app/backend/server.py").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------------------------------------------------------------------
# Code-inspection tests (deterministic — cannot be spoofed by network)
# ------------------------------------------------------------------
class TestGmailSyncCode403Branch:
    """server.py gmail_sync MUST contain the improved 403 branch."""

    def test_403_branch_exists(self):
        assert "list_res.status_code == 403" in SERVER_PY, (
            "Expected explicit `if list_res.status_code == 403:` branch in "
            "gmail_sync (server.py)."
        )

    def test_403_raises_http_403(self):
        # Grab a window of code around the 403 branch and confirm it raises 403.
        m = re.search(
            r"list_res\.status_code == 403[\s\S]{0,1200}?raise HTTPException\(\s*status_code=403",
            SERVER_PY,
        )
        assert m, (
            "403 branch must raise HTTPException(status_code=403). Not found."
        )

    def test_403_hint_mentions_gmail_api_enabled(self):
        assert "Gmail API is not enabled" in SERVER_PY, (
            "403 hint text must contain 'Gmail API is not enabled' so users "
            "know the external fix."
        )

    def test_403_hint_mentions_cloud_console_url(self):
        assert (
            "console.cloud.google.com/apis/library/gmail.googleapis.com"
            in SERVER_PY
        ), (
            "403 hint text must point users to "
            "console.cloud.google.com/apis/library/gmail.googleapis.com."
        )


class TestGmailSyncCode502Wrap:
    """Non-403 Gmail API errors must be wrapped as 502 with Google's actual
    error message surfaced in the detail."""

    def test_httpstatuserror_branch_exists(self):
        assert "except httpx.HTTPStatusError" in SERVER_PY, (
            "gmail_sync must have `except httpx.HTTPStatusError` branch to "
            "wrap non-2xx as 502 with Google's message."
        )

    def test_502_reads_googles_error_message(self):
        # Confirm the branch reads e.response.json() and pulls out
        # error.message before raising 502.
        m = re.search(
            r"except httpx\.HTTPStatusError[\s\S]{0,600}?"
            r"e\.response\.json\(\)[\s\S]{0,400}?"
            r"raise HTTPException\(\s*[\s\S]{0,200}?status_code=502",
            SERVER_PY,
        )
        assert m, (
            "HTTPStatusError branch must call e.response.json() to extract "
            "error.message and then raise HTTPException(status_code=502)."
        )

    def test_502_detail_includes_gmail_api_error_prefix(self):
        assert "Gmail API error" in SERVER_PY, (
            "502 detail should include a 'Gmail API error' prefix so the "
            "frontend can display Google's real message."
        )


# ------------------------------------------------------------------
# Live HTTP tests
# ------------------------------------------------------------------
class TestGmailSyncLive:
    def test_bogus_access_token_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/gmail/sync",
            json={"access_token": "invalid-token-xxx"},
            timeout=30,
        )
        assert r.status_code == 401, f"{r.status_code} {r.text[:300]}"
        # Detail should be 'access_token expired' per server.py.
        assert "access_token expired" in (r.json().get("detail") or ""), (
            f"unexpected detail: {r.json()}"
        )

    def test_missing_access_token_returns_400(self, api_client):
        r = api_client.post(
            f"{API}/gmail/sync",
            json={"access_token": ""},
            timeout=15,
        )
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"
        assert "access_token missing" in (r.json().get("detail") or "")


# ------------------------------------------------------------------
# Regression: other endpoints still healthy
# ------------------------------------------------------------------
class TestRegression:
    def test_health(self, api_client):
        r = api_client.get(f"{API}/health", timeout=15)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_gmail_start_redirects_with_full_client_id(self, api_client):
        r = requests.get(
            f"{API}/gmail/start",
            params={"return_url": "ordervault://gmail-connected"},
            allow_redirects=False,
            timeout=20,
        )
        assert r.status_code in (302, 303, 307)
        loc = r.headers.get("location") or r.headers.get("Location") or ""
        assert "accounts.google.com/o/oauth2/v2/auth" in loc
        assert (
            "client_id=501695473048-usisj9i3b5o4b35kr3fslavust3olomd."
            "apps.googleusercontent.com" in loc
        ), f"client_id missing/incorrect in redirect: {loc[:400]}"

    def test_session_consume_bad_id_returns_404(self, api_client):
        r = api_client.post(
            f"{API}/gmail/session/consume",
            json={"session_id": "TEST_bogus_session_id_xxx"},
            timeout=15,
        )
        assert r.status_code == 404
        assert r.json().get("detail") == "Session expired or invalid"

    def test_refresh_bad_token_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/gmail/refresh",
            json={"refresh_token": "invalid-fake-token"},
            timeout=30,
        )
        assert r.status_code == 401

    def test_revoke_returns_true(self, api_client):
        r = api_client.post(
            f"{API}/gmail/revoke",
            json={"token": "anything"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json() == {"revoked": True}

    def test_parse_text_still_works(self, api_client):
        r = api_client.post(
            f"{API}/parse/text",
            json={"text": "Amazon order Nike shoes Rs 2499 order id 405-1234"},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        for k in ("product_name", "price", "platform"):
            assert k in data

    def test_ocr_order_endpoint_present(self, api_client):
        """OCR endpoint must exist. Send an obviously invalid (empty) base64
        so we exercise the route without spending an LLM call. Anything other
        than 404 proves the route is mounted."""
        r = api_client.post(
            f"{API}/ocr/order",
            json={"image_base64": ""},
            timeout=30,
        )
        assert r.status_code != 404, (
            f"/api/ocr/order route is missing (got 404): {r.text[:200]}"
        )
