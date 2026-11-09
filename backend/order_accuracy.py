"""Evidence-first extraction helpers for Gmail shopping messages.

Never promote an order to a later state merely because time has passed.
"""
import base64
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser


class _EmailHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("br", "p", "div", "tr", "li", "table", "h1", "h2", "h3"):
            self.parts.append("\n")
        if tag in ("td", "th"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        if tag in ("p", "div", "tr", "li", "table"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def email_body(payload):
    """Prefer plain text; traverse nested multipart and HTML-only messages."""
    plain, rich = [], []

    def walk(part):
        mime = part.get("mimeType", "")
        body = part.get("body") or {}
        data = body.get("data")
        if data:
            try:
                decoded = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")
            except (ValueError, TypeError):
                decoded = ""
            if mime == "text/plain":
                plain.append(decoded)
            elif mime == "text/html":
                parser = _EmailHTML()
                parser.feed(decoded)
                rich.append("".join(parser.parts))
        for child in part.get("parts") or []:
            walk(child)

    if isinstance(payload, dict):
        walk(payload)
    result = "\n".join(plain if any(s.strip() for s in plain) else rich)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(result)).strip()


def gmail_date(internal_ms=None, header=None):
    """Normalize Gmail timestamps to timezone-aware ISO 8601 UTC."""
    if internal_ms is not None:
        try:
            return datetime.fromtimestamp(int(internal_ms) / 1000, tz=timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError):
            pass
    if header:
        try:
            dt = parsedate_to_datetime(header)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, IndexError):
            pass
    return None


PRICE = re.compile(
    r"(?<!\w)(?:₹\s*|Rs\.?\s*|INR\s+|\$\s*)([0-9]{1,3}(?:,[0-9]{2,3})*|[0-9]{1,7})(?:\.([0-9]{1,2}))?(?!\d)",
    re.I,
)
LABELED_PRICE = re.compile(
    r"\b(?:grand\s+total|order\s+total|total\s+amount|amount\s+paid|amount\s+payable|subtotal|price|cost|total|paid|charged)\s*[:=]\s*([0-9]{1,7}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)(?!\d)",
    re.I,
)


def confirmed_price(text):
    """Return an amount only when it has currency or an explicit amount label."""
    if not text:
        return None
    for pattern in (PRICE, LABELED_PRICE):
        match = pattern.search(text)
        if match:
            raw = match.group(1).replace(",", "")
            if pattern is PRICE and match.group(2):
                raw += "." + match.group(2)
            try:
                amount = float(raw)
            except ValueError:
                continue
            if 0 < amount < 1000000:
                return amount
    return None


ORDER_ID = re.compile(
    r"\border\s*(?:id|number|no\.?|#)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9-]{4,})\b",
    re.I,
)


def confirmed_order_id(text):
    """Only accept identifiers preceded by an explicit order identifier label."""
    if not text:
        return None
    match = ORDER_ID.search(text)
    if not match:
        return None
    candidate = match.group(1).upper().strip("-")
    if candidate.lower() in ("placed", "shipped", "details", "status", "confirm"):
        return None
    return candidate if any(c.isdigit() for c in candidate) else None


STATUS_PATTERNS = (
    ("Cancelled", r"\b(?:order\s+)?cancel(?:led|ed|lation)?\b"),
    ("Returned", r"\b(?:return(?:ed|\s+initiated|\s+approved)|refund(?:ed)?)\b"),
    ("Exchanged", r"\bexchang(?:e|ed)\b"),
    ("Delivered", r"\b(?:has been|was|successfully|is)\s+delivered\b|\bdelivered\s+(?:on|at|to)\b|\bdelivery\s+(?:completed|confirmed)\b"),
    ("Out for Delivery", r"\bout for delivery\b"),
    ("Shipped", r"\b(?:has been|was|is)\s+(?:shipped|dispatched)\b|\b(?:in transit|shipment dispatched|on its way)\b"),
    ("Ordered", r"\border\s+(?:placed|confirmed|confirmation)\b"),
)


def confirmed_status(subject, body=""):
    """Subject is higher-confidence than body, which may quote old events."""
    for source in (subject or "", body or ""):
        for status, pattern in STATUS_PATTERNS:
            if re.search(pattern, source, re.I):
                return status
    return None


def order_key(item):
    """Unknown IDs are message-specific; known IDs must also match platform and item."""
    platform = (item.platform or "unknown").strip().casefold()
    product = re.sub(r"\s+", " ", (item.product_name or "").strip()).casefold()
    if item.order_id:
        return ("order", platform, item.order_id.strip().upper(), product)
    return ("message", item.message_id, product)


def message_timestamp(value):
    if not value:
        return 0
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
        except (ValueError, TypeError, IndexError):
            return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def merge_by_evidence(items):
    """Preserve newest confirmed status, without losing earlier product metadata."""
    merged = {}
    for item in sorted(items, key=lambda x: message_timestamp(x.email_date)):
        key = order_key(item)
        previous = merged.get(key)
        if previous is not None:
            for field in ("product_name", "price", "order_date", "expected_delivery", "quantity"):
                if getattr(item, field, None) in (None, "", 0):
                    setattr(item, field, getattr(previous, field, None))
            if not item.status:
                item.status = previous.status
            if not item.actual_delivery:
                item.actual_delivery = previous.actual_delivery
        merged[key] = item
    return list(merged.values())


def explicit_products(body):
    """Extract multiple line-separated products only from a clearly labeled list."""
    match = re.search(r"(?im)^\s*(?:items ordered|products ordered|ordered items)\s*:\s*\n((?:.+\n?){1,16})", body or "")
    if not match:
        return []
    products = []
    for line in match.group(1).splitlines():
        line = line.strip(" \t-*•")
        if not line or re.match(r"(?i)(subtotal|total|shipping|delivery|order id|tax|payment|price)\b", line):
            break
        line = re.sub(r"(?i)\s+(?:qty|quantity)\s*:?\s*\d+\s*$", "", line).strip()
        if len(line) >= 3 and line not in products:
            products.append(line[:250])
    return products[:12]
