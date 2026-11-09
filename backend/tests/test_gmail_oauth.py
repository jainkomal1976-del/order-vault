"""
OrderVault Gmail OAuth backend tests.

Verifies the /api/gmail/* endpoints after the Client-ID fix:
  * /api/gmail/start issues a valid Google auth URL (correct client_id with
    numeric prefix, redirect_uri, 4 scopes, offline, consent).
  * Following that URL lands on Google's real sign-in page, NOT
    accounts.google.com/signin/oauth/error (which would mean invalid_client).
  * /api/gmail/session/consume with a bogus id -> 404.
  * /api/gmail/refresh with a bogus token -> 401.
  * /api/gmail/sync with a bogus access token -> 401.
  * /api/gmail/revoke -> {revoked: true} (best-effort).
  * /api/parse/text still works (regression).
  * /api/health still works (regression).
"""
import os
from urllib.parse import urlparse, parse_qs

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

EXPECTED_CLIENT_ID = (
    "501695473048-usisj9i3b5o4b35kr3fslavust3olomd.apps.googleusercontent.com"
)
EXPECTED_REDIRECT_URI = f"{BASE_URL}/api/gmail/callback"
EXPECTED_SCOPES = {
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
}


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Regression ----------
class TestRegression:
    def test_health(self, api_client):
        r = api_client.get(f"{API}/health", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "ok"

    def test_parse_text(self, api_client):
        r = api_client.post(
            f"{API}/parse/text",
            json={"text": "Amazon order Nike shoes Rs 2499 order id 405-1234"},
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        for k in ["product_name", "price", "platform"]:
            assert k in data, f"missing key {k} in {data}"


# ---------- Gmail Start (redirect assembly) ----------
class TestGmailStart:
    def test_start_returns_redirect_to_google_with_correct_params(self, api_client):
        r = requests.get(
            f"{API}/gmail/start",
            params={"return_url": "ordervault://gmail-connected"},
            allow_redirects=False,
            timeout=20,
        )
        assert r.status_code in (302, 303, 307), (
            f"expected redirect, got {r.status_code} body={r.text[:300]}"
        )
        loc = r.headers.get("location") or r.headers.get("Location")
        assert loc, "no Location header on redirect"

        parsed = urlparse(loc)
        assert parsed.netloc == "accounts.google.com", f"unexpected host: {parsed.netloc}"
        assert parsed.path == "/o/oauth2/v2/auth", f"unexpected path: {parsed.path}"

        qs = parse_qs(parsed.query)
        client_id = (qs.get("client_id") or [""])[0]
        redirect_uri = (qs.get("redirect_uri") or [""])[0]
        scope_str = (qs.get("scope") or [""])[0]
        access_type = (qs.get("access_type") or [""])[0]
        prompt = (qs.get("prompt") or [""])[0]

        # Full client_id with the leading numeric prefix — this is the fix.
        assert client_id == EXPECTED_CLIENT_ID, (
            f"WRONG client_id in redirect: {client_id!r} "
            f"(expected {EXPECTED_CLIENT_ID!r})"
        )
        assert client_id.startswith("501695473048-"), (
            f"client_id missing numeric prefix: {client_id!r}"
        )
        assert redirect_uri == EXPECTED_REDIRECT_URI, (
            f"redirect_uri mismatch: {redirect_uri!r}"
        )

        scopes = set(scope_str.split(" ")) if scope_str else set()
        assert EXPECTED_SCOPES.issubset(scopes), (
            f"missing scopes. got={scopes} expected⊇{EXPECTED_SCOPES}"
        )

        assert access_type == "offline", f"access_type={access_type}"
        assert prompt == "consent", f"prompt={prompt}"

    def test_start_google_accepts_the_url(self, api_client):
        """Follow the Google URL — should land on the real sign-in page,
        NOT accounts.google.com/signin/oauth/error (invalid_client)."""
        r = requests.get(
            f"{API}/gmail/start",
            params={"return_url": "ordervault://gmail-connected"},
            allow_redirects=False,
            timeout=20,
        )
        loc = r.headers.get("location") or r.headers.get("Location")
        assert loc, "no location from /api/gmail/start"

        follow = requests.get(
            loc,
            allow_redirects=True,
            timeout=25,
            headers={
                # Realistic browser UA so Google returns HTML sign-in, not a bot page
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        final_url = follow.url
        body_lower = follow.text.lower()

        assert "signin/oauth/error" not in final_url, (
            f"landed on Google error page (invalid_client): {final_url}"
        )
        assert "error/deleted_client" not in final_url, (
            f"landed on deleted_client page: {final_url}"
        )
        assert "invalid_client" not in body_lower, (
            "response body still contains 'invalid_client'"
        )

        # Positive signal: real sign-in page has this title / identifier path.
        looks_like_signin = (
            "sign in - google accounts" in body_lower
            or "/v3/signin/identifier" in final_url
            or "/signin/identifier" in final_url
            or "/signin/v2/identifier" in final_url
            or "accounts.google.com/signin" in final_url
        )
        assert looks_like_signin, (
            f"did not land on Google sign-in. final_url={final_url} "
            f"title_snippet={body_lower[:400]!r}"
        )


# ---------- Session consume ----------
class TestSessionConsume:
    def test_bogus_session_returns_404(self, api_client):
        r = api_client.post(
            f"{API}/gmail/session/consume",
            json={"session_id": "TEST_definitely_not_real_" + "x" * 12},
            timeout=15,
        )
        assert r.status_code == 404, f"{r.status_code} {r.text[:200]}"
        assert r.json().get("detail") == "Session expired or invalid"


# ---------- Refresh token ----------
class TestRefresh:
    def test_invalid_refresh_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/gmail/refresh",
            json={"refresh_token": "invalid-fake-token"},
            timeout=30,
        )
        assert r.status_code == 401, f"{r.status_code} {r.text[:300]}"


# ---------- Sync with bad token ----------
class TestSync:
    def test_invalid_access_token_returns_401(self, api_client):
        r = api_client.post(
            f"{API}/gmail/sync",
            json={"access_token": "invalid-fake-token"},
            timeout=30,
        )
        assert r.status_code == 401, f"{r.status_code} {r.text[:300]}"


# ---------- Revoke ----------
class TestRevoke:
    def test_revoke_always_ok(self, api_client):
        r = api_client.post(
            f"{API}/gmail/revoke",
            json={"token": "anything"},
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert r.json() == {"revoked": True}
