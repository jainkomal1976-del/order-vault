"""Tests for status extraction from Gmail-imported order emails.
Covers backend /api/parse/text status field + code inspection of
_status_from_subject rule engine and OCRResponse schema.
"""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
BASE_URL = BASE_URL.rstrip('/')

VALID_STATUSES = {
    'Ordered', 'Shipped', 'Out for Delivery',
    'Delivered', 'Returned', 'Exchanged', 'Cancelled',
}


@pytest.fixture(scope='module')
def api():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


# ---------- /api/parse/text status extraction (LLM-driven) ----------
class TestParseTextStatus:
    def _parse(self, api, text):
        r = api.post(f"{BASE_URL}/api/parse/text", json={'text': text}, timeout=60)
        assert r.status_code == 200, f"parse/text non-200: {r.status_code} {r.text[:200]}"
        j = r.json()
        assert 'status' in j, f"response missing 'status' field: {j.keys()}"
        return j

    def test_delivered_amazon(self, api):
        text = ("Subject: Your Amazon.in order has been delivered\n"
                "Your order of Nike Revolution 6 shoes worth Rs. 2499 "
                "(order ID 405-1234567-1234567) has been delivered on 15 Feb 2026.")
        j = self._parse(api, text)
        assert j['status'] == 'Delivered', f"expected Delivered, got {j['status']} | full: {j}"

    def test_out_for_delivery_flipkart(self, api):
        text = ("Subject: Your Flipkart order is out for delivery today\n"
                "Your order will arrive today. Product: OnePlus buds, Rs. 1999.")
        j = self._parse(api, text)
        assert j['status'] == 'Out for Delivery', f"got {j['status']} | full: {j}"

    def test_ordered_amazon(self, api):
        text = ("Subject: Thank you for your order\n"
                "Thank you for your order. Your Amazon.in order of "
                "Adidas socks worth Rs. 399 has been placed.")
        j = self._parse(api, text)
        assert j['status'] == 'Ordered', f"got {j['status']} | full: {j}"

    def test_shipped_myntra(self, api):
        text = ("Subject: Your Myntra order has been shipped\n"
                "Your Myntra order has been shipped and is on the way. "
                "Product: Puma T-Shirt, Rs. 899")
        j = self._parse(api, text)
        assert j['status'] == 'Shipped', f"got {j['status']} | full: {j}"

    def test_cancelled_meesho(self, api):
        text = ("Subject: Your Meesho order has been cancelled\n"
                "Your Meesho order has been cancelled. Refund initiated.")
        j = self._parse(api, text)
        assert j['status'] == 'Cancelled', f"got {j['status']} | full: {j}"


# ---------- Schema/coercion inspection ----------
class TestOCRResponseSchema:
    def test_ocr_response_has_status_field(self, api):
        # trigger a light parse and just confirm status field is exposed on the response
        r = api.post(f"{BASE_URL}/api/parse/text",
                     json={'text': 'Subject: Order placed. Product X Rs. 100.'},
                     timeout=60)
        assert r.status_code == 200
        assert 'status' in r.json()

    def test_coerce_parsed_rejects_invalid_status(self):
        # Direct import to check the coerce logic — deterministic
        import sys
        sys.path.insert(0, '/app/backend')
        from server import _coerce_parsed  # type: ignore
        res = _coerce_parsed({'status': 'Bogus'})
        assert res.status is None, f"invalid status should be nulled, got {res.status}"
        res2 = _coerce_parsed({'status': 'Delivered'})
        assert res2.status == 'Delivered'
        res3 = _coerce_parsed({})
        assert res3.status is None


# ---------- Rule-based subject inspection ----------
class TestStatusFromSubject:
    def test_helper_exists_and_maps_correctly(self):
        import sys
        sys.path.insert(0, '/app/backend')
        from server import _status_from_subject  # type: ignore
        assert _status_from_subject("Your Amazon.in order has been delivered") == 'Delivered'
        assert _status_from_subject("Your Flipkart order is out for delivery") == 'Out for Delivery'
        assert _status_from_subject("Your Myntra order has been shipped") == 'Shipped'
        assert _status_from_subject("Your order has been dispatched") == 'Shipped'
        assert _status_from_subject("Your order is on the way") == 'Shipped'
        assert _status_from_subject("Your Meesho order has been cancelled") == 'Cancelled'
        assert _status_from_subject("Return initiated for your order") == 'Returned'
        assert _status_from_subject("Exchange request received") == 'Exchanged'
        assert _status_from_subject("Thank you for your order") == 'Ordered'
        assert _status_from_subject("") is None
        assert _status_from_subject(None) is None
        assert _status_from_subject("Random newsletter") is None

    def test_gmail_sync_uses_subject_override(self):
        # Inspect server.py source to confirm gmail_sync calls _status_from_subject
        # AFTER LLM parse and overrides item.status.
        with open('/app/backend/server.py') as f:
            src = f.read()
        # Extract gmail_sync function block
        m = re.search(r'async def gmail_sync\(.*?\n(.*?)\napp\.include_router',
                      src, re.DOTALL)
        assert m, "gmail_sync fn not found"
        body = m.group(1)
        # Ensure LLM parse call precedes subject override
        parse_idx = body.find('_gemini_parse_text')
        subj_idx = body.find('_status_from_subject')
        override_idx = body.find('item.status = subj_status')
        fallback_idx = body.find('item.status = "Ordered"')
        assert parse_idx != -1 and subj_idx != -1 and override_idx != -1, \
            "expected LLM parse, subject override, and item.status assign in gmail_sync"
        assert parse_idx < subj_idx, "LLM parse must run before subject override"
        assert subj_idx < override_idx, "subject override must set item.status"
        assert fallback_idx != -1, "Missing final fallback item.status = 'Ordered'"
        assert fallback_idx > override_idx, "'Ordered' fallback must come after subject override"


# ---------- Regression: existing endpoints still work ----------
class TestRegression:
    def test_health(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get('status') == 'ok'

    def test_gmail_start_redirect(self, api):
        r = api.get(f"{BASE_URL}/api/gmail/start",
                    params={'return_url': 'ordervault://done'},
                    allow_redirects=False, timeout=10)
        assert r.status_code == 307, f"expected 307 redirect, got {r.status_code}"
        loc = r.headers.get('location', '')
        assert 'accounts.google.com/o/oauth2/v2/auth' in loc
        assert 'client_id=501695473048-usisj9i3b5o4b35kr3fslavust3olomd.apps.googleusercontent.com' in loc

    def test_session_consume_bad_id(self, api):
        r = api.post(f"{BASE_URL}/api/gmail/session/consume",
                     json={'session_id': 'nonexistent'}, timeout=10)
        assert r.status_code == 404

    def test_gmail_refresh_bad_token(self, api):
        r = api.post(f"{BASE_URL}/api/gmail/refresh",
                     json={'refresh_token': 'bogus-refresh-token'}, timeout=15)
        assert r.status_code == 401

    def test_gmail_sync_bad_token(self, api):
        r = api.post(f"{BASE_URL}/api/gmail/sync",
                     json={'access_token': 'bogus-access-token',
                           'since_days': 15, 'max_messages': 5}, timeout=20)
        assert r.status_code == 401

    def test_ocr_order_route_mounted(self, api):
        # Empty base64 will 502 from LLM but route must not be 404
        r = api.post(f"{BASE_URL}/api/ocr/order", json={'image_base64': ''}, timeout=15)
        assert r.status_code != 404
