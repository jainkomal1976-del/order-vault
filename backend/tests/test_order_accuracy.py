"""Regression coverage for merchant email parsing; all fixtures are synthetic."""
import base64
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from order_accuracy import (
    confirmed_order_id, confirmed_price, confirmed_status, email_body,
    explicit_products, gmail_date, merge_by_evidence,
)


def item(mid, platform, order_id, name, date, status):
    return SimpleNamespace(
        message_id=mid, platform=platform, order_id=order_id,
        product_name=name, email_date=date, status=status,
        price=None, order_date=None, expected_delivery=None,
        actual_delivery=None, quantity=1,
    )


class EmailAccuracyTests(unittest.TestCase):
    def test_old_out_for_delivery_never_becomes_delivered(self):
        self.assertEqual(confirmed_status("Amazon: out for delivery", ""), "Out for Delivery")

    def test_shipping_states_and_explicit_delivery(self):
        self.assertEqual(confirmed_status("Flipkart: your order has been shipped"), "Shipped")
        self.assertEqual(confirmed_status("Myntra: your order has been delivered"), "Delivered")
        self.assertEqual(confirmed_status("Meesho: order confirmed"), "Ordered")
        self.assertEqual(confirmed_status("AJIO: your order is out for delivery"), "Out for Delivery")
        self.assertEqual(confirmed_status("Nykaa: shipment dispatched"), "Shipped")

    def test_no_price_from_order_number_or_dates(self):
        self.assertIsNone(confirmed_price("Order ID: OD123456789, delivery 12/11/2026"))
        self.assertEqual(confirmed_price("Price: ₹1,299.00"), 1299.0)
        self.assertEqual(confirmed_price("Grand Total: 849.50"), 849.5)
        self.assertIsNone(confirmed_price("Your OTP is 123456"))

    def test_order_id_requires_explicit_label(self):
        self.assertEqual(confirmed_order_id("Order ID: OD123456789"), "OD123456789")
        self.assertEqual(confirmed_order_id("Order # 123-1234567-1234567"), "123-1234567-1234567")
        self.assertIsNone(confirmed_order_id("Shipment AWB123456789"))

    def test_distinct_merchants_cannot_merge(self):
        orders = [
            item("a", "Amazon", "AB12345", "Shirt", "2026-11-01T10:00:00+00:00", "Ordered"),
            item("b", "Flipkart", "AB12345", "Shirt", "2026-11-03T10:00:00+00:00", "Delivered"),
        ]
        self.assertEqual(len(merge_by_evidence(orders)), 2)

    def test_same_product_without_id_not_merged(self):
        orders = [
            item("a", "Meesho", None, "Kurta", "2026-11-01T10:00:00+00:00", "Ordered"),
            item("b", "Meesho", None, "Kurta", "2026-11-02T10:00:00+00:00", "Shipped"),
        ]
        self.assertEqual(len(merge_by_evidence(orders)), 2)

    def test_status_tracks_latest_confirmed_email(self):
        orders = [
            item("new", "Amazon", "123-1234567-1234567", "Book", "2026-11-04T10:00:00+00:00", "Shipped"),
            item("old", "Amazon", "123-1234567-1234567", "Book", "2026-11-02T10:00:00+00:00", "Ordered"),
        ]
        merged = merge_by_evidence(orders)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].status, "Shipped")

    def test_utc_gmail_dates(self):
        self.assertEqual(gmail_date("1762603200000"), "2025-11-08T12:00:00+00:00")
        self.assertEqual(gmail_date(None, "Sat, 08 Nov 2025 17:30:00 +0530"), "2025-11-08T12:00:00+00:00")

    def test_nested_html_only_email(self):
        raw = "<html><style>.hide{display:none}</style><div>Items Ordered:</div><table><tr><td>Blue shirt</td></tr><tr><td>Black jeans</td></tr></table></html>"
        data = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
        body = email_body({"mimeType": "multipart/mixed", "parts": [
            {"mimeType": "multipart/alternative", "parts": [
                {"mimeType": "text/html", "body": {"data": data}}
            ]}
        ]})
        self.assertIn("Blue shirt", body)
        self.assertIn("Black jeans", body)
        self.assertNotIn("display:none", body)

    def test_multiple_products(self):
        body = "Items Ordered:\nCotton kurta\nDenim jeans\nSubtotal: ₹1,299\n"
        self.assertEqual(explicit_products(body), ["Cotton kurta", "Denim jeans"])


if __name__ == "__main__":
    unittest.main()
