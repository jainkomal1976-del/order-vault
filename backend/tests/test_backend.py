"""
OrderVault backend tests
Covers: /api/, /api/health, /api/ocr/order (valid, data-URI prefix, invalid)
"""
import base64
import os
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://order-central-88.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_IMG = Path(__file__).parent / "test_ecom.jpg"


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def real_image_b64():
    assert TEST_IMG.exists(), f"missing test image: {TEST_IMG}"
    data = TEST_IMG.read_bytes()
    return base64.b64encode(data).decode("ascii")


# ---------- Health / root ----------
class TestBasics:
    def test_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("message") == "OrderVault API running"

    def test_health(self, api_client):
        r = api_client.get(f"{API}/health")
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "ok"


# ---------- OCR ----------
class TestOCR:
    def test_ocr_valid_image(self, api_client, real_image_b64):
        r = api_client.post(
            f"{API}/ocr/order",
            json={"image_base64": real_image_b64},
            timeout=90,
        )
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
        data = r.json()
        # Response schema keys must exist (values may be null)
        for k in ["product_name", "price", "platform", "order_date", "quantity", "order_id"]:
            assert k in data, f"missing key {k} in {data}"
        # At least SOME field should have been extracted or quantity default set
        assert data.get("quantity") is not None

    def test_ocr_data_uri_prefix_stripped(self, api_client, real_image_b64):
        prefixed = f"data:image/jpeg;base64,{real_image_b64}"
        r = api_client.post(
            f"{API}/ocr/order",
            json={"image_base64": prefixed},
            timeout=90,
        )
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
        data = r.json()
        assert "product_name" in data

    def test_ocr_invalid_payload_no_crash(self, api_client):
        # Invalid base64 (junk) -- server should return 502 (per handler) or 200 with nulls
        r = api_client.post(
            f"{API}/ocr/order",
            json={"image_base64": "notreallybase64!!!"},
            timeout=90,
        )
        assert r.status_code != 500, f"server crashed 500: {r.text[:400]}"
        # Accept either 502 (OCR failed) or 200 (graceful)
        assert r.status_code in (200, 400, 422, 502), f"unexpected {r.status_code}: {r.text[:400]}"
