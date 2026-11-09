from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import uuid
import base64
import time
import asyncio
from datetime import datetime, timedelta
import logging
from pathlib import Path
from urllib.parse import urlencode
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Initialize database client
mongo_url = os.environ['MONGO_URL']
_is_mongomock = False  # Track which database we're using

# Try to use mongomock for development (works without real MongoDB)
try:
    import mongomock
    client = mongomock.MongoClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    _is_mongomock = True
    logger.info("✅ Using mongomock (in-memory database)")
except Exception as e:
    logger.warning(f"⚠️  mongomock not available: {e}")
    logger.info("📍 Attempting to connect to MongoDB...")
    try:
        client = AsyncIOMotorClient(mongo_url)
        db = client[os.environ['DB_NAME']]
        logger.info("✅ Connected to MongoDB")
    except Exception as mongo_error:
        logger.error(f"❌ Database initialization failed: {mongo_error}")
        raise

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_WEB_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_WEB_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI = os.environ.get(
    'GOOGLE_REDIRECT_URI',
    'https://order-central-88.preview.emergentagent.com/api/gmail/callback',
)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

# In-memory stores (single-user preview app) with TTL cleanup.
_state_store: Dict[str, Dict[str, Any]] = {}  # state -> {return_url, ts}
_session_store: Dict[str, Dict[str, Any]] = {}  # session_id -> {tokens..., ts}
_STATE_TTL_SEC = 900  # 15 minutes - allow more time for OAuth flow
_SESSION_TTL_SEC = 300
_CONSUMED_SESSION_TTL_SEC = 60
# store recently-consumed sessions so repeated /session/consume calls (e.g. duplicate
# callbacks or retries from clients) can still return the tokens for a short window
# instead of returning 404. Key -> sess dict
_consumed_session_store: Dict[str, Dict[str, Any]] = {}


def _cleanup_stores() -> None:
    now = time.time()
    for k, v in list(_state_store.items()):
        if now - v.get("ts", 0) > _STATE_TTL_SEC:
            _state_store.pop(k, None)
    for k, v in list(_session_store.items()):
        if now - v.get("ts", 0) > _SESSION_TTL_SEC:
            _session_store.pop(k, None)
    for k, v in list(_consumed_session_store.items()):
        if now - v.get("ts", 0) > _CONSUMED_SESSION_TTL_SEC:
            _consumed_session_store.pop(k, None)


async def _store_oauth_state(state: str, return_url: str) -> None:
    """Store OAuth state in both memory and database for redundancy."""
    _state_store[state] = {"return_url": return_url, "ts": time.time()}
    logger.info(f"✅ Stored OAuth state in memory: {state[:16]}... -> {return_url}")

    # Also persist to database for cross-worker/restart safety
    try:
        oauth_collection = db["oauth_states"]
        if _is_mongomock:
            # Synchronous mongomock
            oauth_collection.insert_one({
                "_id": state,
                "return_url": return_url,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(seconds=_STATE_TTL_SEC),
            })
        else:
            # Async motor
            await oauth_collection.insert_one({
                "_id": state,
                "return_url": return_url,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(seconds=_STATE_TTL_SEC),
            })
        logger.info(f"✅ Persisted OAuth state to database: {state[:16]}...")
    except Exception as e:
        logger.warning(f"⚠️  Failed to persist OAuth state to database: {e}")
        # Continue anyway - memory store is still available


async def _retrieve_oauth_state(state: str) -> Optional[Dict[str, Any]]:
    """Retrieve OAuth state from memory first, then database as fallback."""
    # Try memory store first
    if state in _state_store:
        logger.info(f"✅ Found OAuth state in memory: {state[:16]}...")
        return _state_store.pop(state)

    # Try database fallback
    try:
        oauth_collection = db["oauth_states"]
        query = {"_id": state, "expires_at": {"$gt": datetime.utcnow()}}

        if _is_mongomock:
            # Synchronous mongomock
            doc = oauth_collection.find_one_and_delete(query)
        else:
            # Async motor
            doc = await oauth_collection.find_one_and_delete(query)

        if doc:
            logger.info(f"✅ Retrieved OAuth state from database: {state[:16]}...")
            return {"return_url": doc.get("return_url"), "ts": time.time()}
    except Exception as e:
        logger.warning(f"⚠️  Failed to retrieve OAuth state from database: {e}")

    return None


# Order-confirmation senders per platform
ECOM_SENDERS: List[str] = [
    # Amazon
    "auto-confirm@amazon.in",
    "shipment-tracking@amazon.in",
    "order-update@amazon.in",
    "auto-confirm@amazon.com",
    # Flipkart
    "noreply@flipkart.com",
    "orderupdates@flipkart.com",
    # Myntra
    "noreply@myntra.com",
    "orders@myntra.com",
    # Ajio
    "noreply@ajio.com",
    "customercare@ajio.com",
    # Nykaa
    "noreply@nykaa.com",
    "orders@nykaa.com",
    # Meesho
    "transaction@meeshomails.com",
    "orders@meesho.com",
    "no-reply@meesho.com",
    # Tira (Reliance beauty)
    "noreply@tirabeauty.com",
    "orders@tirabeauty.com",
    "hello@tirabeauty.com",
    "no-reply@tirabeauty.com",
]


app = FastAPI()
api_router = APIRouter(prefix="/api")


# Startup event to create database indexes
@app.on_event("startup")
async def startup_event():
    """Create necessary indexes for OAuth state cleanup."""
    try:
        oauth_collection = db["oauth_states"]
        if _is_mongomock:
            # mongomock doesn't support async, and TTL indexes are limited
            logger.info("✅ OAuth state collection ready (mongomock - no TTL index)")
        else:
            # Create TTL index for automatic expiration of OAuth states
            await oauth_collection.create_index("expires_at", expireAfterSeconds=0)
            logger.info("✅ Created TTL index for oauth_states collection")
    except Exception as e:
        logger.warning(f"⚠️  Could not create TTL index (may already exist): {e}")



# ---------- Pydantic models ----------
class OCRRequest(BaseModel):
    image_base64: str


class TextParseRequest(BaseModel):
    text: str


class OCRResponse(BaseModel):
    product_name: Optional[str] = None
    price: Optional[float] = None
    platform: Optional[str] = None
    order_date: Optional[str] = None
    expected_delivery: Optional[str] = None
    actual_delivery: Optional[str] = None
    quantity: Optional[int] = 1
    order_id: Optional[str] = None
    status: Optional[str] = None
    raw: Optional[str] = None


class SessionConsumeRequest(BaseModel):
    session_id: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class RevokeRequest(BaseModel):
    token: str  # access or refresh token


class GmailSyncRequest(BaseModel):
    access_token: str
    since_days: int = 30
    max_messages: int = 25


class ParsedOrderItem(BaseModel):
    message_id: str
    email_subject: Optional[str] = None
    email_from: Optional[str] = None
    email_date: Optional[str] = None
    product_name: Optional[str] = None
    price: Optional[float] = None
    platform: Optional[str] = None
    order_date: Optional[str] = None
    expected_delivery: Optional[str] = None
    actual_delivery: Optional[str] = None
    quantity: Optional[int] = 1
    order_id: Optional[str] = None
    status: Optional[str] = None
    parse_error: Optional[str] = None


# ---------- Basic ----------
@api_router.get("/")
async def root():
    return {"message": "OrderVault API running"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


# ---------- OCR / Text parsing ----------
OCR_SYSTEM_PROMPT = (
    "You extract structured order details from an e-commerce order confirmation "
    "(screenshot or email text) from Amazon, Flipkart, Myntra, Ajio, Nykaa, Meesho, Tira "
    "or similar Indian e-commerce platforms.\n"
    "Return ONLY a strict JSON object with these keys — no prose, no markdown:\n"
    "{\n"
    '  "product_name": string (normalized: remove color/size variations, extract core product name),\n'
    '  "price": number (in INR, digits only, no currency symbol, extract the item/product price not total),\n'
    '  "platform": one of ["Amazon","Flipkart","Myntra","Ajio","Nykaa","Meesho","Tira","Other"],\n'
    '  "order_date": string in YYYY-MM-DD (or null if unclear) — when the order was PLACED\n'
    '  "expected_delivery": string in YYYY-MM-DD (or null) — the promised / expected delivery date. Look for phrases like "Arriving by", "Expected delivery", "Delivery by", "Estimated delivery", "Get by", "Scheduled delivery".\n'
    '  "actual_delivery": string in YYYY-MM-DD (or null) — only fill this if the email explicitly says the item WAS delivered on a date (e.g. "delivered on 15 Feb 2026"). Leave null for order-confirmation / shipping stage emails.\n'
    '  "quantity": integer (default 1),\n'
    '  "order_id": string (or null) — CRITICAL: always extract if visible, this is the unique identifier,\n'
    '  "status": one of ["Ordered","Shipped","Out for Delivery","Delivered","Returned","Exchanged","Cancelled"] — infer from the email/screenshot:\n'
    '     • "Delivered" if the message confirms the item was delivered / handed over / received\n'
    '     • "Out for Delivery" if it says out for delivery / arriving today / ofd\n'
    '     • "Shipped" if it says shipped / dispatched / on the way / in transit / in motion\n'
    '     • "Cancelled" if it says cancelled / order cancelled\n'
    '     • "Returned" / "Exchanged" if the message is about a return/exchange\n'
    '     • Otherwise default to "Ordered"\n'
    "}\n"
    "CRITICAL EXTRACTION RULES:\n"
    "• PRODUCT_NAME NORMALIZATION: Remove variant info like colors (Black, Blue, Red), sizes (S, M, L, XL), or pack quantities from the core product name. Store only the base product name.\n"
    "  Example: 'Sanfe At-Home Silk Thread Remover - Black' should become 'Sanfe At-Home Silk Thread Remover'\n"
    "  Example: '100 Pcs Oil Blotting Sheets' stays as is (quantity is part of product identity)\n"
    "• ORDER_ID: This MUST be extracted accurately and completely. It is the most reliable deduplication key.\n"
    "  Examples: 405-1234567-1234567, OD123456789, 123456789\n"
    "• PRICE: Extract the price of the product/item, not shipping or total. Look for 'Price:', 'Amount:', 'Cost:', 'Subtotal:', 'Item price:', or currency symbols (₹, Rs, INR).\n"
    "• STATUS: Email subject lines are usually most reliable. For very recent emails about shipments, infer delivery status accurately.\n"
    "• ACTUAL_DELIVERY: Only set this if email explicitly confirms delivery. If email says 'out for delivery' or 'arriving', this should be null and status should be 'Out for Delivery'.\n"
    "If a field is not visible, use null. Never invent data."
)


def _parse_json_from_text(text: str) -> dict:
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {}


def _coerce_parsed(data: dict, raw_text: str = "") -> OCRResponse:
    price_val = data.get("price")
    try:
        price_val = float(price_val) if price_val is not None else None
    except Exception:
        price_val = None
    qty_val = data.get("quantity") or 1
    try:
        qty_val = int(qty_val)
    except Exception:
        qty_val = 1
    valid_statuses = {
        "Ordered",
        "Shipped",
        "Out for Delivery",
        "Delivered",
        "Returned",
        "Exchanged",
        "Cancelled",
    }
    status_val = data.get("status")
    if status_val not in valid_statuses:
        status_val = None
    return OCRResponse(
        product_name=data.get("product_name") or None,
        price=price_val,
        platform=data.get("platform") or None,
        order_date=data.get("order_date") or None,
        expected_delivery=data.get("expected_delivery") or None,
        actual_delivery=data.get("actual_delivery") or None,
        quantity=qty_val,
        order_id=data.get("order_id") or None,
        status=status_val,
        raw=raw_text[:2000] if raw_text else None,
    )


@api_router.post("/ocr/order", response_model=OCRResponse)
async def ocr_order(payload: OCRRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    b64 = payload.image_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[-1]
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ocr-{uuid.uuid4()}",
            system_message=OCR_SYSTEM_PROMPT,
        ).with_model("gemini", "gemini-2.5-flash")
        user_msg = UserMessage(
            text="Extract the order details from this screenshot and return JSON.",
            file_contents=[ImageContent(image_base64=b64)],
        )
        raw = await chat.send_message(user_msg)
        raw_text = raw if isinstance(raw, str) else str(raw)
    except Exception as e:
        logger.exception("OCR failed")
        raise HTTPException(status_code=502, detail=f"OCR failed: {e}")
    return _coerce_parsed(_parse_json_from_text(raw_text), raw_text)


async def _gemini_parse_text(text: str) -> OCRResponse:
    """Shared helper: send arbitrary text to Gemini and get an OCRResponse."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")
    if len(text) > 20000:
        text = text[:20000]
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"parse-{uuid.uuid4()}",
            system_message=OCR_SYSTEM_PROMPT,
        ).with_model("gemini", "gemini-2.5-flash")
        raw = await chat.send_message(
            UserMessage(
                text=(
                    "Extract the order details from this text (email, SMS, or "
                    "notification body) and return JSON only.\n\n---\n" + text
                )
            )
        )
        raw_text = raw if isinstance(raw, str) else str(raw)
    except Exception as e:
        logger.exception("parse_text failed")
        raise HTTPException(status_code=502, detail=f"Parse failed: {e}")
    return _coerce_parsed(_parse_json_from_text(raw_text), raw_text)


@api_router.post("/parse/text", response_model=OCRResponse)
async def parse_text(payload: TextParseRequest):
    return await _gemini_parse_text(payload.text)


# ---------- Gmail OAuth ----------
GMAIL_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
]


@api_router.get("/gmail/start")
async def gmail_start(return_url: str):
    _cleanup_stores()
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_WEB_CLIENT_ID not configured")
    state = uuid.uuid4().hex
    await _store_oauth_state(state, return_url)
    logger.info(f"🔐 Redirecting to Google OAuth with state: {state[:16]}...")
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # force refresh_token every time in preview
        "include_granted_scopes": "true",
        "state": state,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


def _bounce_html(target_url: str, message: str = "") -> HTMLResponse:
    """HTML page that immediately redirects to a target URL (works for custom app
    schemes and https alike). Includes a visible message + manual link fallback."""
    safe_url = target_url.replace("&", "&amp;").replace('"', "&quot;")
    body = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrderVault — signing you in…</title>
<style>
body {{ font-family: -apple-system, system-ui, sans-serif; background:#0b0b0d; color:#f5f5f7;
       display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; }}
.card {{ max-width:340px; text-align:center; }}
h1 {{ font-size:18px; margin:0 0 8px; }}
p {{ font-size:14px; color:#a1a1a6; line-height:1.5; margin:0 0 20px; }}
a.btn {{ display:inline-block; background:#fff; color:#000; padding:12px 22px; border-radius:999px;
        text-decoration:none; font-weight:600; font-size:14px; }}
</style></head><body>
<div class="card">
  <h1>Almost done</h1>
  <p>{message or 'Returning you to OrderVault…'}</p>
  <a class="btn" href="{safe_url}">Open OrderVault</a>
</div>
<script>
  window.location.replace("{safe_url}");
  setTimeout(function() {{ window.location.href = "{safe_url}"; }}, 400);
</script>
</body></html>"""
    return HTMLResponse(content=body)


@api_router.get("/gmail/callback")
async def gmail_callback(request: Request):
    _cleanup_stores()
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    err = request.query_params.get("error")

    logger.info(f"🔐 Gmail callback hit - code: {code[:20] if code else 'None'}..., state: {state[:20] if state else 'None'}..., error: {err}")

    if err:
        logger.error(f"❌ Google error: {err}")
        return _bounce_html(
            "ordervault://gmail-connected?error=" + err,
            f"Google returned an error: {err}",
        )
    if not code or not state:
        logger.error("❌ Missing code or state")
        raise HTTPException(status_code=400, detail="Missing code or state")

    st = await _retrieve_oauth_state(state)
    if not st:
        logger.error(f"❌ Invalid or expired state: {state[:16]}... Available states: {list(_state_store.keys())[:3]}")
        raise HTTPException(status_code=400, detail="Invalid or expired state. Please try signing in again.")

    return_url = st["return_url"]
    logger.info(f"✅ Retrieved return URL: {return_url}")

    # Exchange code for tokens
    async with httpx.AsyncClient(timeout=20) as hc:
        try:
            tok_res = await hc.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri": GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            tok_res.raise_for_status()
            tok = tok_res.json()
            logger.info("✅ Token exchange successful")
        except httpx.HTTPStatusError as e:
            logger.error("❌ Token exchange failed: %s", e.response.text)
            return _bounce_html(
                f"{return_url}?error=token_exchange_failed",
                "Sign-in failed. Please try again.",
            )
        except Exception as e:
            logger.exception("❌ Token exchange error")
            return _bounce_html(
                f"{return_url}?error=network",
                f"Sign-in failed: {e}",
            )

        # Fetch user email
        email = None
        try:
            info = await hc.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {tok.get('access_token','')}"},
            )
            if info.status_code == 200:
                email = info.json().get("email")
                logger.info(f"✅ Got email: {email}")
        except Exception as e:
            logger.error(f"⚠️  Failed to get user info: {e}")
            pass

    session_id = uuid.uuid4().hex
    _session_store[session_id] = {
        "access_token": tok.get("access_token"),
        "refresh_token": tok.get("refresh_token"),
        "expires_in": tok.get("expires_in", 3600),
        "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)) - 30,
        "email": email,
        "ts": time.time(),
    }
    logger.info(f"✅ Session stored: {session_id[:8]}...")

    sep = "&" if "?" in return_url else "?"
    final = f"{return_url}{sep}session={session_id}"
    logger.info(f"✅ Redirecting to: {final}")
    return _bounce_html(final, "Signed in! Returning to OrderVault…")


@api_router.post("/gmail/session/consume")
async def gmail_session_consume(payload: SessionConsumeRequest):
    _cleanup_stores()
    logger.info(f"🔄 Session consume requested: {payload.session_id[:8]}...")
    # First try to pop an active session (one-time consume). If not present,
    # check the recently-consumed cache and return the same tokens for a short
    # grace period to avoid 404s caused by duplicate requests.
    sess = _session_store.pop(payload.session_id, None)
    if sess:
        logger.info(f"✅ Active session found and consumed: {payload.session_id[:8]}...")
        # Store a copy in the consumed cache so repeated consumes within a
        # short window can still succeed (protects against duplicate requests).
        copy = dict(sess)
        copy["ts"] = time.time()
        _consumed_session_store[payload.session_id] = copy
    else:
        sess = _consumed_session_store.get(payload.session_id)
        if not sess:
            logger.warning(f"❌ Session not found (expired): {payload.session_id[:8]}...")
            raise HTTPException(status_code=404, detail="Session expired or invalid")
        logger.info(f"♻️ Using cached consumed session: {payload.session_id[:8]}... (grace period)")
    return {
        "access_token": sess["access_token"],
        "refresh_token": sess["refresh_token"],
        "expires_at": sess["expires_at"],
        "email": sess.get("email"),
    }


class CreateSessionRequest(BaseModel):
    access_token: str
    refresh_token: Optional[str] = ""
    expires_in: Optional[int] = 3600
    email: Optional[str] = None


@api_router.post("/_test/create_session")
async def test_create_session(payload: CreateSessionRequest):
    """Test-only endpoint: create a session in the in-memory session store.
    Enabled when DEBUG_ALLOW_TEST=1 in the environment. Returns session_id.
    """
    if os.environ.get("DEBUG_ALLOW_TEST") != "1":
        raise HTTPException(status_code=403, detail="Test endpoints disabled")
    session_id = uuid.uuid4().hex
    _session_store[session_id] = {
        "access_token": payload.access_token,
        "refresh_token": payload.refresh_token or "",
        "expires_in": payload.expires_in or 3600,
        "expires_at": int(time.time()) + int(payload.expires_in or 3600) - 30,
        "email": payload.email,
        "ts": time.time(),
    }
    logger.info(f"Test session created: {session_id} (email={payload.email})")
    return {"session_id": session_id}


@api_router.post("/gmail/refresh")
async def gmail_refresh(payload: TokenRefreshRequest):
    if not payload.refresh_token:
        raise HTTPException(status_code=400, detail="refresh_token missing")
    async with httpx.AsyncClient(timeout=20) as hc:
        try:
            r = await hc.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "refresh_token": payload.refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            r.raise_for_status()
            tok = r.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=401, detail=f"Refresh failed: {e.response.text}")
    return {
        "access_token": tok.get("access_token"),
        "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)) - 30,
    }


@api_router.post("/gmail/revoke")
async def gmail_revoke(payload: RevokeRequest):
    async with httpx.AsyncClient(timeout=15) as hc:
        try:
            await hc.post(
                GOOGLE_REVOKE_URL,
                data={"token": payload.token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except Exception:
            pass
    return {"revoked": True}


# ---------- Gmail Sync ----------
def _extract_message_body(payload: Dict[str, Any]) -> str:
    """Recursively find text/plain (fallback: text/html stripped) parts and concat."""
    if not payload:
        return ""

    def _decode_data(data: str) -> str:
        try:
            return base64.urlsafe_b64decode(data + "===").decode("utf-8", errors="ignore")
        except Exception:
            return ""

    def _walk(part: Dict[str, Any], want_html: bool = False) -> List[str]:
        out: List[str] = []
        mime = part.get("mimeType", "")
        if mime.startswith("multipart/"):
            for sub in part.get("parts", []) or []:
                out.extend(_walk(sub, want_html))
            return out
        body = part.get("body", {}) or {}
        data = body.get("data")
        if not data:
            return out
        if mime == "text/plain" and not want_html:
            out.append(_decode_data(data))
        elif mime == "text/html" and want_html:
            html = _decode_data(data)
            # Simple HTML strip
            html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
            html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.IGNORECASE)
            html = re.sub(r"<[^>]+>", " ", html)
            html = re.sub(r"\s+", " ", html)
            out.append(html)
        return out

    parts_txt = _walk(payload, want_html=False)
    text = "\n".join([p for p in parts_txt if p.strip()])
    if text.strip():
        return text
    parts_html = _walk(payload, want_html=True)
    return "\n".join([p for p in parts_html if p.strip()])


def _get_header(headers: List[Dict[str, str]], name: str) -> Optional[str]:
    lname = name.lower()
    for h in headers or []:
        if h.get("name", "").lower() == lname:
            return h.get("value")
    return None


def _sender_platform(from_header: Optional[str]) -> Optional[str]:
    """Detect e-commerce platform from email sender address."""
    if not from_header:
        return None
    f = from_header.lower()

    # Amazon (including regional domains)
    if any(k in f for k in ["amazon.in", "amazon.com", "amazonses.com", "auto-confirm@amazon", "shipment-tracking@amazon", "order-update@amazon"]):
        return "Amazon"

    # Flipkart
    if any(k in f for k in ["flipkart", "fkart"]):
        return "Flipkart"

    # Myntra
    if "myntra" in f:
        return "Myntra"

    # Ajio (Reliance)
    if "ajio" in f:
        return "Ajio"

    # Nykaa
    if "nykaa" in f:
        return "Nykaa"

    # Meesho
    if "meesho" in f:
        return "Meesho"

    # Tira (Reliance beauty)
    if "tira" in f or "tirabeauty" in f:
        return "Tira"

    # Snapdeal
    if "snapdeal" in f:
        return "Other"  # Can add specific support later

    return None


def _status_from_subject(subject: Optional[str]) -> Optional[str]:
    """Fast rule-based status detection from email subject. Very reliable —
    e-commerce subjects almost always spell out the stage explicitly.
    Enhanced: more comprehensive pattern matching."""
    if not subject:
        return None
    s = subject.lower()

    # Order of checks matters: check most-advanced states first

    # CANCELLED - highest priority as it's terminal
    if any(k in s for k in ["cancel", "cancelled", "order cancel"]):
        return "Cancelled"

    # RETURNED - terminal state
    if any(k in s for k in ["refund", "return ", "returned", "return initiated", "return request"]) or s.startswith("return"):
        return "Returned"

    # EXCHANGED - terminal state
    if any(k in s for k in ["exchange", "exchanged", "swap"]):
        return "Exchanged"

    # DELIVERED - item received
    if any(
        k in s
        for k in [
            "delivered",
            "has been delivered",
            "successfully delivered",
            "your delivery",
            "delivery confirmed",
            "delivery complete",
            "order received",
            "order arrived",
        ]
    ):
        return "Delivered"

    # OUT FOR DELIVERY - about to deliver
    if any(
        k in s
        for k in [
            "out for delivery",
            "arriving today",
            "arriving tomorrow",
            "expected today",
            "ofd",
            "out for dispatch",
            "arriving",
            "delivery today",
            "will arrive today",
            "arriving by today",
        ]
    ):
        return "Out for Delivery"

    # SHIPPED - in transit
    if any(
        k in s
        for k in [
            "shipped",
            "dispatched",
            "on the way",
            "on its way",
            "shipment",
            "in transit",
            "in motion",
            "dispatch",
            "has been shipped",
        ]
    ):
        return "Shipped"

    # ORDERED - confirmed order
    if any(
        k in s
        for k in [
            "order placed",
            "order confirmed",
            "order confirmation",
            "thank you for your order",
            "we've received your order",
            "we have received your order",
            "your order",
            "order received",
            "confirmation",
        ]
    ):
        return "Ordered"

    return None


def _try_parse_date_str(s: str, ref_dt: Optional[datetime] = None) -> Optional[str]:
    """Try several common date formats and return ISO date (YYYY-MM-DD) or None.
    If s contains words like 'today' or 'yesterday' use ref_dt if provided.
    Enhanced: handles more formats and relative dates."""
    if not s:
        return None
    s = s.strip()
    low = s.lower()

    # Handle relative dates
    if "today" in low and ref_dt:
        return ref_dt.date().isoformat()
    if "yesterday" in low and ref_dt:
        return (ref_dt.date() - timedelta(days=1)).isoformat()
    if "tomorrow" in low and ref_dt:
        return (ref_dt.date() + timedelta(days=1)).isoformat()

    # Remove common prefixes and suffixes
    s = re.sub(r"\b(?:on|by|delivered on|delivered:|arrival|at|by)\b", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"[,\.]$", "", s).strip()

    # Try multiple formats - ordered by likelihood
    fmts = [
        "%d %b %Y",      # 15 Feb 2026
        "%d %B %Y",      # 15 February 2026
        "%b %d, %Y",     # Feb 15, 2026
        "%B %d, %Y",     # February 15, 2026
        "%Y-%m-%d",      # 2026-02-15
        "%d-%m-%Y",      # 15-02-2026
        "%d/%m/%Y",      # 15/02/2026
        "%d %b %y",      # 15 Feb 26
        "%b %d %Y",      # Feb 15 2026
        "%d.%m.%Y",      # 15.02.2026
        "%m/%d/%Y",      # 02/15/2026 (US format)
        "%Y/%m/%d",      # 2026/02/15
        "%d %m %Y",      # 15 02 2026
    ]

    s_clean = s.strip()
    for fmt in fmts:
        try:
            d = datetime.strptime(s_clean, fmt)
            return d.date().isoformat()
        except Exception:
            pass

    # Try to extract ISO format YYYY-MM-DD anywhere in string
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if m:
        return m.group(1)

    # Try to find patterns like "15 Feb 2026" or "15-Feb-2026" anywhere
    m = re.search(r"(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})", s)
    if m:
        try:
            # Try full month name first
            d = datetime.strptime(m.group(1), "%d %B %Y")
            return d.date().isoformat()
        except Exception:
            try:
                # Try abbreviated month name
                d = datetime.strptime(m.group(1), "%d %b %Y")
                return d.date().isoformat()
            except Exception:
                pass

    # Try numeric-only patterns like "15/02/2026" or "15-02-2026"
    m = re.search(r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})", s)
    if m:
        date_str = m.group(1)
        for sep_fmt in ["%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%m-%d-%Y"]:
            try:
                d = datetime.strptime(date_str, sep_fmt)
                return d.date().isoformat()
            except Exception:
                pass

    return None


def _status_from_body(body: str, email_dt: Optional[str] = None) -> Dict[str, Optional[str]]:
    """Inspect body text to infer status and actual_delivery date where possible.
    Returns dict with keys: status (str or None), actual_delivery (ISO date or None)
    Enhanced: better pattern matching for delivery confirmation."""
    out_status = None
    out_date = None
    if not body:
        return {"status": None, "actual_delivery": None}

    low = body.lower()

    # Look for explicit delivery confirmations first (highest confidence)
    delivery_keywords = [
        "delivered on", "successfully delivered", "was delivered", "delivered at",
        "delivered:", "your order was delivered", "item delivered", "has been delivered",
        "delivery completed", "order delivered"
    ]

    if any(k in low for k in delivery_keywords):
        out_status = "Delivered"
    elif any(k in low for k in ["out for delivery", "arriving today", "arriving tomorrow", "ofd", "out for dispatch"]):
        out_status = "Out for Delivery"
    elif any(k in low for k in ["shipped", "dispatched", "on the way", "in transit", "shipment", "in motion", "in flight"]):
        out_status = "Shipped"
    elif any(k in low for k in ["cancelled", "order cancelled", "canceled"]):
        out_status = "Cancelled"
    elif any(k in low for k in ["returned", "return initiated", "return request", "return approved"]):
        out_status = "Returned"
    elif any(k in low for k in ["exchange", "exchange request", "exchanged"]):
        out_status = "Exchanged"

    # Try to capture a delivered date from the body
    email_dt_obj = None
    if email_dt:
        try:
            from email.utils import parsedate_to_datetime
            email_dt_obj = parsedate_to_datetime(email_dt)
        except Exception:
            email_dt_obj = None

    # Look for delivery date explicitly mentioned
    patterns = [
        r"delivered\s+(?:on|:)\s*([A-Za-z0-9, \-/]+?)(?:\n|at|by)",
        r"delivered\s+(?:date)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)",
        r"delivery\s+(?:on|date)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)",
        r"arrived\s+(?:on|:)\s*([A-Za-z0-9, \-/]+?)(?:\n)",
        r"received\s+(?:on|:)\s*([A-Za-z0-9, \-/]+?)(?:\n)",
    ]

    for p in patterns:
        m = re.search(p, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1), ref_dt=email_dt_obj)
            if parsed:
                out_date = parsed
                out_status = out_status or "Delivered"
                break

    # If we saw 'delivered' but no explicit date, fall back to email date
    if out_status == "Delivered" and not out_date and email_dt_obj:
        out_date = email_dt_obj.date().isoformat()

    return {"status": out_status, "actual_delivery": out_date}


def _parse_price(text: str) -> Optional[float]:
    """Extract first plausible price from text (₹, Rs, or plain digits).
    Improved: handles multiple currency formats and context."""
    if not text:
        return None

    # Priority 1: Common price patterns with currency symbols: ₹299, Rs. 299, INR 299
    patterns = [
        r"(?:Price|Total|Cost|Amount)[:\s]*(?:₹|Rs\.?|INR\s*)\s*([0-9]{1,3}(?:[,0-9]{0,})?(?:\.\d{1,2})?)",
        r"(?:₹|Rs\.?|INR\s*)\s*([0-9]{1,3}(?:[,0-9]{0,})?(?:\.\d{1,2})?)",
        r"(?:Rs\s|₹\s|INR\s)([0-9]{1,6}(?:[,0-9]{0,})?(?:\.\d{1,2})?)",
    ]

    for pattern in patterns:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if m:
            try:
                price_str = m.group(1).replace(",", "")
                price = float(price_str)
                if 0 < price < 1000000:  # Reasonable price range for e-commerce
                    return price
            except Exception:
                pass

    # Priority 2: Numbers near "price", "cost", "amount", "total" keywords
    m = re.search(r"(?:price|cost|amount|total|paid|charged)[:\s]*([0-9]{1,6}(?:\.[0-9]{1,2})?)", text, flags=re.IGNORECASE)
    if m:
        try:
            price = float(m.group(1))
            if 0 < price < 1000000:
                return price
        except Exception:
            pass

    # Priority 3: Extract from "Subtotal", "Grand Total", "Amount Payable" patterns
    m = re.search(r"(?:Subtotal|Grand\s+Total|Amount\s+Payable|Total\s+Price)[:\s]*(?:₹|Rs\.?|INR)?\s*([0-9]{1,6}(?:[,0-9]{0,})?(?:\.\d{1,2})?)", text, flags=re.IGNORECASE)
    if m:
        try:
            price_str = m.group(1).replace(",", "")
            price = float(price_str)
            if 0 < price < 1000000:
                return price
        except Exception:
            pass
    return None


def _parse_amazon_body(body: str) -> Dict[str, Optional[str]]:
    """Heuristic extraction for Amazon order emails with improved patterns."""
    out: Dict[str, Optional[str]] = {
        "product_name": None,
        "price": None,
        "order_id": None,
        "expected_delivery": None,
        "order_date": None,
        "quantity": None,
    }
    if not body:
        return out

    # Order ID patterns: Order # 123-1234567-1234567, Order ID: 123-..., ASIN patterns
    patterns = [
        r"order\s*(?:#|id)?\s*[:#\s]*([0-9A-Z\-]{6,})",  # Standard order ID
        r"(?:Amazon\s+)?Order\s+(?:ID|Number|#)?[:\s]*([0-9A-Z\-]+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            oid = m.group(1).strip()
            if len(oid) >= 6:
                out["order_id"] = oid
                break

    # Product name extraction - multiple strategies
    # Strategy 1: "Items Ordered:" section
    m = re.search(r"Items Ordered[:\s\-]+([\s\S]{5,500}?)(?:\n\n|Price|Subtotal|Amount)", body, flags=re.IGNORECASE)
    if m:
        candidate = re.sub(r"\s+", " ", m.group(1)).strip()
        # Remove quantity indicators
        candidate = re.sub(r"\bQty[:\s]+\d+", "", candidate, flags=re.IGNORECASE).strip()
        out["product_name"] = candidate[:250]
    else:
        # Strategy 2: "Your Order of <product>"
        m = re.search(r"(?:Your\s+)?order\s+of\s+(.+?)(?:\.|\n|for|has been|with|worth|₹|Rs)", body, flags=re.IGNORECASE)
        if m:
            out["product_name"] = m.group(1).strip()[:250]
        else:
            # Strategy 3: Line after "Order Details"
            m = re.search(r"Order\s+Details[:\s]+(.+?)(?:\n|Price|₹)", body, flags=re.IGNORECASE)
            if m:
                out["product_name"] = m.group(1).strip()[:250]

    # Price extraction
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Expected delivery patterns - multiple keywords
    delivery_keywords = [
        "Arriving by", "Estimated delivery", "Expected delivery", "Delivery by",
        "Will arrive by", "Expected to arrive", "Estimated to arrive", "Get by"
    ]
    for keyword in delivery_keywords:
        pattern = rf"{keyword}[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|Expected|Order Status)"
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["expected_delivery"] = parsed
                break

    # Order date patterns
    date_patterns = [
        r"Order placed[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|at)",
        r"Order date[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|Order|Order placed)",
        r"(?:Placed on|Order created on)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|at)",
    ]
    for pattern in date_patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["order_date"] = parsed
                break

    # Quantity extraction
    m = re.search(r"(?:Qty|Quantity)[:\s]*(\d+)", body, flags=re.IGNORECASE)
    if m:
        try:
            out["quantity"] = m.group(1)
        except Exception:
            pass

    return out


def _parse_flipkart_body(body: str) -> Dict[str, Optional[str]]:
    """Improved extraction for Flipkart order emails."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Flipkart order id common patterns: Order ID: OD12345, Order# FK123456
    patterns = [
        r"Order\s*ID[:\s]*([A-Za-z0-9\-]+)",
        r"Order\s*#[:\s]*([A-Za-z0-9\-]+)",
        r"(?:Flipkart\s+)?Order[:\s]*([A-Z]{2}\d{6,})",
    ]
    for pattern in patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            oid = m.group(1).strip()
            if len(oid) >= 5:
                out["order_id"] = oid
                break

    # Product name extraction - improved strategies
    # Strategy 1: Section between "Product Details" or "Item Details"
    m = re.search(r"(?:Product|Item)\s*Details[:\s\-]+([\s\S]{5,400}?)(?:\n\n|Delivery|Price|Expected|₹|Rs)", body, flags=re.IGNORECASE)
    if m:
        out["product_name"] = re.sub(r"\s+", " ", m.group(1)).strip()[:250]
    else:
        # Strategy 2: "Ordered items" section
        m = re.search(r"(?:Ordered|Your)\s+(?:items?|Product)[:\s]*(.+?)(?:\n|Price|₹)", body, flags=re.IGNORECASE)
        if m:
            out["product_name"] = m.group(1).strip()[:250]
        else:
            # Strategy 3: Title-like structure
            lines = body.split('\n')
            for line in lines:
                if 'order' in line.lower() and len(line) > 10 and len(line) < 200:
                    out["product_name"] = line.strip()[:250]
                    break

    # Price extraction
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Delivery date extraction - multiple patterns
    delivery_patterns = [
        r"Delivery\s+(?:by|on)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|Expected|Standard)",
        r"Expected\s+Delivery[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|Standard|Scheduled)",
        r"Scheduled\s+Delivery[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|by|on)",
    ]
    for pattern in delivery_patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["expected_delivery"] = parsed
                break

    # Order date
    date_patterns = [
        r"Order\s+(?:placed|date|created)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|on|at)",
        r"(?:Placed on|Ordered on|Order date)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|at|Order)",
    ]
    for pattern in date_patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["order_date"] = parsed
                break

    return out


def _parse_generic_body(body: str) -> Dict[str, Optional[str]]:
    """Generic extraction for all other e-commerce platforms."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Order ID extraction with multiple patterns
    patterns = [
        r"Order\s*(?:ID|No|Number|#)[:\s]*([A-Za-z0-9\-]{5,})",
        r"(?:Transaction|Invoice|Ref)\s*(?:ID|No|#)[:\s]*([A-Za-z0-9\-]+)",
        r"(?:Order|Reference)\s*ID[:\s]*([A-Za-z0-9\-]+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            oid = m.group(1).strip()
            if len(oid) >= 5:
                out["order_id"] = oid
                break

    # Product name extraction - multiple strategies
    # Strategy 1: After "Item(s):", "Product(s):", or "Your order of"
    m = re.search(r"(?:Item[s]?[:\s]|Product[s]?[:\s]|Your order of\s+)([\s\S]{5,300}?)(?:\n\n|Price|Cost|Amount|₹|Rs|\nOrder)", body, flags=re.IGNORECASE)
    if m:
        candidate = re.sub(r"\s+", " ", m.group(1)).strip()
        # Clean up common patterns
        candidate = re.sub(r"\bQty[:\s]+\d+", "", candidate, flags=re.IGNORECASE).strip()
        candidate = re.sub(r"\bQuantity[:\s]+\d+", "", candidate, flags=re.IGNORECASE).strip()
        out["product_name"] = candidate[:250]
    else:
        # Strategy 2: Subject line fallback or first substantial line
        lines = [l.strip() for l in body.split('\n') if l.strip() and len(l.strip()) > 10]
        for line in lines:
            if not line.startswith('From:') and not line.startswith('Date:') and not line.startswith('Subject:'):
                if len(line) < 200 and ('order' not in line.lower() or 'product' in line.lower() or 'item' in line.lower()):
                    out["product_name"] = line[:250]
                    break

    # Price extraction
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Expected delivery - generic patterns
    delivery_patterns = [
        r"(?:Delivery|Arrival|Arriving|Expected)[:\s]*(?:by|on)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|Expected)",
        r"(?:Will arrive|Expected to arrive|Estimated arrival)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)",
        r"(?:Deliver|Arrival)\s+date[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)",
    ]
    for pattern in delivery_patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["expected_delivery"] = parsed
                break

    # Order date
    date_patterns = [
        r"Order\s+(?:placed|date|created|on)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)",
        r"(?:Placed on|Ordered on|Order date)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|at)",
    ]
    for pattern in date_patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            parsed = _try_parse_date_str(m.group(1))
            if parsed:
                out["order_date"] = parsed
                break

    # Quantity
    m = re.search(r"(?:Qty|Quantity)[:\s]*(\d+)", body, flags=re.IGNORECASE)
    if m:
        try:
            out["quantity"] = m.group(1)
        except Exception:
            pass

    return out


def _parse_myntra_body(body: str) -> Dict[str, Optional[str]]:
    """Extraction for Myntra order emails."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Myntra order ID pattern
    m = re.search(r"Order\s*(?:ID|#)[:\s]*([A-Z0-9]{8,})", body, flags=re.IGNORECASE)
    if m:
        out["order_id"] = m.group(1).strip()

    # Product name
    patterns = [
        r"(?:Item|Product)[:\s]*(.+?)(?:\n|Quantity|Price|₹)",
        r"(?:Article|Style)[:\s]*(.+?)(?:\n|Qty|Size)",
    ]
    for pattern in patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            out["product_name"] = m.group(1).strip()[:250]
            break

    # Price
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Delivery date
    m = re.search(r"(?:Expected|Estimated)\s+(?:Delivery|Arrival)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n|by)", body, flags=re.IGNORECASE)
    if m:
        parsed = _try_parse_date_str(m.group(1))
        if parsed:
            out["expected_delivery"] = parsed

    # Order date
    m = re.search(r"(?:Order|Placed)\s+(?:on|Date)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)", body, flags=re.IGNORECASE)
    if m:
        parsed = _try_parse_date_str(m.group(1))
        if parsed:
            out["order_date"] = parsed

    return out


def _parse_nykaa_body(body: str) -> Dict[str, Optional[str]]:
    """Extraction for Nykaa/Tira order emails."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Order ID
    m = re.search(r"Order\s*(?:ID|#|Number)[:\s]*([A-Z0-9]{8,})", body, flags=re.IGNORECASE)
    if m:
        out["order_id"] = m.group(1).strip()

    # Product name
    patterns = [
        r"(?:Product|Item)[:\s]*(.+?)(?:\n|Price|Quantity)",
        r"(?:Beauty\s+)?Product[:\s]*(.+?)(?:\n|₹|Rs)",
    ]
    for pattern in patterns:
        m = re.search(pattern, body, flags=re.IGNORECASE)
        if m:
            out["product_name"] = m.group(1).strip()[:250]
            break

    # Price
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Delivery date
    m = re.search(r"(?:Delivery|Arrival)\s+(?:Date|by)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)", body, flags=re.IGNORECASE)
    if m:
        parsed = _try_parse_date_str(m.group(1))
        if parsed:
            out["expected_delivery"] = parsed

    return out


def _parse_meesho_body(body: str) -> Dict[str, Optional[str]]:
    """Extraction for Meesho order emails."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Meesho order ID
    m = re.search(r"Order\s*(?:ID|#)[:\s]*([A-Z0-9]{6,})", body, flags=re.IGNORECASE)
    if m:
        out["order_id"] = m.group(1).strip()

    # Product name
    m = re.search(r"(?:Product|Item)[:\s]*(.+?)(?:\n|Price|₹)", body, flags=re.IGNORECASE)
    if m:
        out["product_name"] = m.group(1).strip()[:250]

    # Price
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Delivery date
    m = re.search(r"(?:Expected|Estimated)\s+(?:Delivery|Arrival)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)", body, flags=re.IGNORECASE)
    if m:
        parsed = _try_parse_date_str(m.group(1))
        if parsed:
            out["expected_delivery"] = parsed

    return out


def _parse_ajio_body(body: str) -> Dict[str, Optional[str]]:
    """Extraction for Ajio order emails."""
    out = {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    if not body:
        return out

    # Ajio order ID
    m = re.search(r"Order\s*(?:ID|Number)[:\s]*([A-Z0-9]{8,})", body, flags=re.IGNORECASE)
    if m:
        out["order_id"] = m.group(1).strip()

    # Product name
    m = re.search(r"(?:Product|Item)[:\s]*(.+?)(?:\n|Price|Qty|₹)", body, flags=re.IGNORECASE)
    if m:
        out["product_name"] = m.group(1).strip()[:250]

    # Price
    p = _parse_price(body)
    if p:
        out["price"] = p

    # Delivery date
    m = re.search(r"(?:Expected\s+)?(?:Delivery|Arrival)[:\s]*([A-Za-z0-9, \-/]+?)(?:\n)", body, flags=re.IGNORECASE)
    if m:
        parsed = _try_parse_date_str(m.group(1))
        if parsed:
            out["expected_delivery"] = parsed

    return out



def _platform_specific_extract(platform: Optional[str], body: str) -> Dict[str, Optional[str]]:
    """Dispatch to platform-specific parsers. Platform can be 'Amazon','Flipkart', etc."""
    if not body:
        return {"product_name": None, "price": None, "order_id": None, "expected_delivery": None, "order_date": None, "quantity": None}
    p = (platform or "").lower()
    if "amazon" in p:
        return _parse_amazon_body(body)
    if "flipkart" in p:
        return _parse_flipkart_body(body)
    if "myntra" in p:
        return _parse_myntra_body(body)
    if "nykaa" in p or "tira" in p:
        return _parse_nykaa_body(body)
    if "meesho" in p:
        return _parse_meesho_body(body)
    if "ajio" in p:
        return _parse_ajio_body(body)
    # Generic fallback for unknown platforms
    return _parse_generic_body(body)


def _normalize_product_name(name: str) -> str:
    """Remove color, size, and variant information from product name.
    Example: 'Sanfe At-Home Silk Thread Remover - Black' -> 'Sanfe At-Home Silk Thread Remover'
    """
    if not name:
        return name

    # Remove common variant patterns at the end
    # Remove " - Color", " - Black", " - Size L", etc.
    name = re.sub(r'\s*-\s*(Black|Blue|Red|Green|White|Gray|Grey|Yellow|Pink|Purple|Orange|Brown|Beige|Silver|Gold|Navy|etc\.|and|plus)[^a-z]*$', '', name, flags=re.IGNORECASE)

    # Remove size specifications like "- Size L", "- XL", "- S/M/L"
    name = re.sub(r'\s*(?:-|,)?\s*(?:Size|Sz)\s+[SMLXLXXL]+[^a-z]*$', '', name, flags=re.IGNORECASE)

    # Remove packaging info like "Pack of 100", "100 Pcs" but only if it's clearly packaging
    # Keep it if it's part of product identity (like "100 Pcs Oil Blotting Sheets")
    # So we only remove if it comes before common variant indicators or at very end
    name = re.sub(r'\s*(?:Pack of|Qty|Quantity)\s+\d+[^a-z]*$', '', name, flags=re.IGNORECASE)

    return name.strip()


def _infer_status_from_age(status: str, email_date: Optional[str]) -> str:
    """Infer actual delivery status based on email age.
    Example: An old "Out for Delivery" email is likely "Delivered" by now.
    """
    if not status or not email_date:
        return status

    # Only adjust if status is "Out for Delivery"
    if status != "Out for Delivery":
        return status

    try:
        from email.utils import parsedate_to_datetime
        email_dt = parsedate_to_datetime(email_date)
        now = datetime.now(email_dt.tzinfo) if email_dt.tzinfo else datetime.utcnow()
        days_old = (now - email_dt).days

        # If email is more than 2 days old and says "Out for Delivery", it's likely delivered
        if days_old > 2:
            logger.info(f"📅 Old 'Out for Delivery' email ({days_old} days) -> marking as 'Delivered'")
            return "Delivered"
    except Exception as e:
        logger.debug(f"Could not parse email date for status inference: {e}")

    return status



@api_router.post("/gmail/sync")
async def gmail_sync(payload: GmailSyncRequest):
    if not payload.access_token:
        raise HTTPException(status_code=400, detail="access_token missing")
    since_days = max(1, min(payload.since_days, 180))
    max_messages = max(1, min(payload.max_messages, 50))

    # Gmail search query
    # Match known ecommerce senders OR look for common order/shipment keywords
    from_clause = " OR ".join([f"from:{s}" for s in ECOM_SENDERS])
    subject_terms = [
        "order",
        "order confirmation",
        "order placed",
        "invoice",
        "shipped",
        "dispatched",
        "delivered",
        "out for delivery",
        "shipment",
        "invoice",
        "refund",
        "return",
        "exchange",
        "delivery",
        "estimated delivery",
        "arriving",
    ]
    # Build subject: clauses, quoting multi-word phrases
    subject_clause = " OR ".join(
        [f'subject:"{t}"' if " " in t else f"subject:{t}" for t in subject_terms]
    )
    q = f"(({from_clause}) OR ({subject_clause})) newer_than:{since_days}d"

    headers = {"Authorization": f"Bearer {payload.access_token}"}
    results: List[ParsedOrderItem] = []
    async with httpx.AsyncClient(timeout=30) as hc:
        try:
            # Loop with pagination to collect up to max_messages message ids
            msgs = []
            page_token = None
            remaining = max_messages
            while remaining > 0:
                params = {"q": q, "maxResults": min(remaining, 100)}
                if page_token:
                    params["pageToken"] = page_token
                list_res = await hc.get(
                    f"{GMAIL_API_BASE}/messages",
                    params=params,
                    headers=headers,
                )
                if list_res.status_code == 401:
                    raise HTTPException(status_code=401, detail="access_token expired")
                if list_res.status_code == 403:
                    body = list_res.text
                    # Try to extract Google's error message
                    try:
                        j = list_res.json()
                        msg = (j.get("error", {}) or {}).get("message") or body
                    except Exception:
                        msg = body
                    hint = (
                        "Gmail API is not enabled for your Google Cloud project, or the "
                        "gmail.readonly scope wasn't granted. Enable Gmail API at "
                        "console.cloud.google.com/apis/library/gmail.googleapis.com "
                        "for your project, then disconnect and reconnect Gmail in Settings."
                    )
                    raise HTTPException(
                        status_code=403,
                        detail=f"{msg} — {hint}",
                    )
                list_res.raise_for_status()
                j = list_res.json()
                batch = j.get("messages", []) or []
                msgs.extend(batch)
                remaining = max_messages - len(msgs)
                page_token = j.get("nextPageToken")
                if not page_token:
                    break
                # small pause to be kind to API
                await asyncio.sleep(0.05)
        except HTTPException:
            raise
        except httpx.HTTPStatusError as e:
            # Surface Google's actual error body for any other non-2xx
            body_text = ""
            try:
                body_text = e.response.text
                j = e.response.json()
                body_text = (j.get("error", {}) or {}).get("message") or body_text
            except Exception:
                pass
            logger.exception("Gmail list failed")
            raise HTTPException(
                status_code=502,
                detail=f"Gmail API error {e.response.status_code}: {body_text[:400]}",
            )
        except Exception as e:
            logger.exception("Gmail list failed")
            raise HTTPException(status_code=502, detail=f"Gmail list failed: {e}")

        # Fetch each message body sequentially (Gmail can rate-limit parallel)
        collected: List[ParsedOrderItem] = []
        for m in msgs:
            mid = m.get("id")
            if not mid:
                continue
            try:
                mres = await hc.get(
                    f"{GMAIL_API_BASE}/messages/{mid}",
                    params={"format": "full"},
                    headers=headers,
                )
                mres.raise_for_status()
                mdata = mres.json()
            except Exception as e:
                results.append(
                    ParsedOrderItem(
                        message_id=mid, parse_error=f"fetch failed: {e}"
                    )
                )
                continue

            hdrs = mdata.get("payload", {}).get("headers", [])
            subject = _get_header(hdrs, "Subject")
            frm = _get_header(hdrs, "From")
            # Prefer Gmail's internalDate (ms since epoch) if available for reliable ordering.
            internal_ms = mdata.get("internalDate")
            date_hdr = _get_header(hdrs, "Date")
            date = None
            if internal_ms:
                try:
                    date = datetime.fromtimestamp(int(internal_ms) / 1000).isoformat()
                except Exception:
                    date = date_hdr
            else:
                date = date_hdr

            body = _extract_message_body(mdata.get("payload", ""))
            snippet = mdata.get("snippet") or ""
            # Combine subject + snippet + first 6k of body for parsing
            text = f"Subject: {subject}\nFrom: {frm}\n\n{body[:6000] or snippet}"

            parsed_platform = _sender_platform(frm)
            item = ParsedOrderItem(
                message_id=mid,
                email_subject=subject,
                email_from=frm,
                email_date=date,
                platform=parsed_platform,
            )
            try:
                pr = await _gemini_parse_text(text)
                item.product_name = pr.product_name
                item.price = pr.price
                if pr.platform:
                    item.platform = pr.platform
                item.order_date = pr.order_date
                item.expected_delivery = pr.expected_delivery
                item.actual_delivery = pr.actual_delivery
                item.quantity = pr.quantity or 1
                item.order_id = pr.order_id
                item.status = pr.status
            except HTTPException as he:
                item.parse_error = str(he.detail)
            except Exception as e:
                item.parse_error = str(e)

            # Post-process: improve status and actual_delivery extraction using body text
            try:
                body_analysis = _status_from_body(body, date)
                # Prefer explicit Delivered detected in body over ambiguous statuses
                if body_analysis.get("status"):
                    item.status = body_analysis.get("status")
                # Fill actual_delivery if available from LLM or body
                if body_analysis.get("actual_delivery") and not item.actual_delivery:
                    item.actual_delivery = body_analysis.get("actual_delivery")
            except Exception:
                pass

            # Platform-specific deterministic extraction (high-precision heuristics)
            try:
                platform_guess = item.platform or parsed_platform
                pext = _platform_specific_extract(platform_guess, body)
                # Use deterministic values when LLM missed them
                if not item.order_id and pext.get("order_id"):
                    item.order_id = pext.get("order_id")
                if (not item.product_name or (item.product_name and len(item.product_name) < 5)) and pext.get("product_name"):
                    item.product_name = pext.get("product_name")
                if (not item.price or item.price == 0) and pext.get("price"):
                    item.price = pext.get("price")
                if not item.expected_delivery and pext.get("expected_delivery"):
                    item.expected_delivery = pext.get("expected_delivery")
                if not item.order_date and pext.get("order_date"):
                    item.order_date = pext.get("order_date")
            except Exception:
                pass

            # Try to extract order id from body if still missing
            if not item.order_id and body:
                morder = re.search(r"(?i)(?:order\s*(?:id|no|number)|order#|order[:#])\s*[:#\-\s]*([A-Za-z0-9-]+)", body)
                if morder:
                    item.order_id = morder.group(1)

            # Fallback: if product name is missing, try to extract from subject
            if not item.product_name and subject:
                # Try to extract from subject line (common Amazon format: "Your Amazon.in order of <product>")
                # Also handle "Order confirmation for <product>"
                import re as regex
                match = regex.search(r"order of\s+(.+?)(?:\s+has|$)", subject, regex.IGNORECASE)
                if match:
                    item.product_name = match.group(1).strip()
                else:
                    match = regex.search(r"confirmation for\s+(.+?)(?:\s+has|$)", subject, regex.IGNORECASE)
                    if match:
                        item.product_name = match.group(1).strip()
                    elif subject and not subject.startswith("Your") and not subject.startswith("Order"):
                        # Use subject as fallback product name if it's not a generic prefix
                        item.product_name = subject[:100]  # Limit to 100 chars

            # Fallback: if price is missing, try to extract from body text
            if not item.price and body:
                import re as regex
                # Look for price patterns like "₹299", "Rs. 299", "Price: ₹299", etc.
                match = regex.search(r"[₹Rs\.]*\s*(\d+(?:,\d{3})*(?:\.\d{2})?)", body)
                if match:
                    try:
                        price_str = match.group(1).replace(",", "")
                        item.price = float(price_str)
                    except Exception:
                        pass

            # If we still don't have a price, use a placeholder so the order can be added
            if not item.price:
                item.price = 0  # Placeholder - user can edit later

            # Subject-line status override — most reliable signal.
            subj_status = _status_from_subject(subject)
            if subj_status:
                item.status = subj_status
            elif not item.status:
                item.status = "Ordered"

            # Normalize product name to remove color/size variants
            if item.product_name:
                item.product_name = _normalize_product_name(item.product_name)

            # Infer status from email age (old "Out for Delivery" emails are likely "Delivered")
            if item.status and date:
                item.status = _infer_status_from_age(item.status, date)

            # If status is Delivered but LLM didn't extract actual_delivery,
            # fall back to the email's send date as a good approximation.
            if item.status == "Delivered" and not item.actual_delivery and date:
                try:
                    from email.utils import parsedate_to_datetime
                    d = parsedate_to_datetime(date)
                    if d:
                        item.actual_delivery = d.date().isoformat()
                except Exception:
                    pass

            collected.append(item)

            # brief pacing to avoid rate limiting
            await asyncio.sleep(0.05)

        # Deduplicate items: prefer entries with an order_id; otherwise group by product+platform.
        from email.utils import parsedate_to_datetime

        dedup: Dict[str, ParsedOrderItem] = {}
        dedup_ts: Dict[str, float] = {}
        for it in collected:
            # Determine key
            key = None
            if it.order_id:
                key = f"id:{it.order_id}"
            else:
                key = f"name:{(it.product_name or '').strip()}|{(it.platform or '').strip()}"

            # Determine timestamp for ordering
            ts = time.time()
            if it.email_date:
                try:
                    dt = parsedate_to_datetime(it.email_date)
                    ts = dt.timestamp()
                except Exception:
                    ts = time.time()

            # Keep the item with latest timestamp
            if key not in dedup or ts > dedup_ts.get(key, 0):
                dedup[key] = it
                dedup_ts[key] = ts

        results = list(dedup.values())

    return {"count": len(results), "items": [r.dict() for r in results]}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
