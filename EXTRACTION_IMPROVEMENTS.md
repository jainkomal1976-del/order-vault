# Order Extraction Logic Improvements

## Overview
The OrderVault backend has been significantly enhanced to improve the accuracy and reliability of extracting order details like price, status, product name, order ID, and delivery dates from e-commerce emails and screenshots.

## Key Improvements

### 1. **Enhanced LLM System Prompt**
- Added more detailed extraction hints for the Gemini LLM
- Specified exact locations where to find each field (Price, Product Name, Order ID, etc.)
- Improved guidance on distinguishing between item price vs. total price
- Better instructions for date extraction with multiple format examples

**Location**: `OCR_SYSTEM_PROMPT` variable

### 2. **Multi-Layered Extraction Strategy**
The system now uses a sophisticated multi-layer approach:

1. **Layer 1**: LLM-based extraction (when available) - high accuracy but slower
2. **Layer 2**: Status detection from email subject - fast and highly reliable
3. **Layer 3**: Platform-specific heuristic parsing - deterministic extraction
4. **Layer 4**: Generic fallback patterns - handles unknown platforms
5. **Layer 5**: Subject line extraction - for missing product names and prices
6. **Layer 6**: Deduplication and final cleanup

### 3. **Price Extraction Enhancements** `_parse_price()`
- Multiple pattern matching strategies with priority ordering
- Looks for currency symbols: ₹, Rs, INR
- Extracts product price vs. total amount
- Keywords: Price, Total, Cost, Amount, Subtotal, Item price
- Price validation: must be between ₹1 to ₹999,999 (reasonable e-commerce range)

**Patterns supported**:
```
Price: ₹299
Rs. 299
INR 299
Amount: ₹1,234.50
₹299.99
```

### 4. **Platform-Specific Extraction Parsers**

#### Amazon `_parse_amazon_body()`
- Order ID patterns: `Order #123-1234567-1234567`
- Product name from "Items Ordered" section
- Delivery date from "Arriving by", "Expected delivery" keywords
- Order date from "Order placed" keyword

#### Flipkart `_parse_flipkart_body()`
- Order ID: `Order ID: OD12345`
- Product details extraction
- Delivery date patterns
- Order date extraction

#### Myntra `_parse_myntra_body()`
- Order ID patterns specific to Myntra
- Product name and style information
- Delivery date extraction

#### Nykaa/Tira `_parse_nykaa_body()`
- Beauty-specific order details
- Product and item extraction

#### Meesho `_parse_meesho_body()`
- Meesho-specific order patterns
- Product and delivery info

#### Ajio `_parse_ajio_body()`
- Ajio order format handling
- Delivery date extraction

#### Generic Fallback `_parse_generic_body()`
- Works with unknown platforms
- Multiple extraction strategies
- Robust pattern matching

### 5. **Enhanced Date Parsing** `_try_parse_date_str()`

Supports 13+ date formats:
- `15 Feb 2026` (common Indian format)
- `15 February 2026` (full month name)
- `Feb 15, 2026` (US format)
- `2026-02-15` (ISO format)
- `15-02-2026` (European format)
- `15/02/2026` (slash separator)
- `15.02.2026` (dot separator)
- And more...

**Special handling**:
- Today/Yesterday/Tomorrow relative dates
- Removes common prefixes: "on", "by", "delivered on"
- Extracts dates embedded within larger text

### 6. **Status Detection**

#### Subject Line Detection `_status_from_subject()`
- Most reliable signal (email subjects clearly indicate status)
- Statuses detected: Ordered, Shipped, Out for Delivery, Delivered, Cancelled, Returned, Exchanged
- Terminal states checked first (Cancelled, Returned, Exchanged)
- Keywords for each status properly categorized

#### Body Text Analysis `_status_from_body()`
- Confirms status from email body
- Extracts actual delivery date when available
- Keywords: "delivered on", "out for delivery", "shipped", "in transit"
- Falls back to email date for "Delivered" status

### 7. **Sender Platform Detection** `_sender_platform()`
Enhanced to detect:
- Amazon (amazon.in, amazon.com, specific Amazon email domains)
- Flipkart
- Myntra
- Ajio
- Nykaa
- Meesho
- Tira (Reliance beauty)
- Snapdeal (marked as Other)

### 8. **Gmail Integration Improvements**
- Better email body extraction (text/plain preferred over HTML)
- HTML cleanup for readable content
- Deduplication by order_id (primary) or product+platform (secondary)
- Proper timestamp handling for ordering

## Extraction Flow

```
Email from Gmail
    ↓
[Extract email metadata: subject, from, date, body]
    ↓
[LLM parsing - if available]
    ↓
[Subject line status detection - most reliable]
    ↓
[Body text analysis - delivery dates & status confirmation]
    ↓
[Platform-specific extraction - fill missing fields]
    ↓
[Generic fallback patterns - catch remaining fields]
    ↓
[Validation & Cleanup]
    ↓
Order extracted with: product_name, price, platform, 
order_date, expected_delivery, actual_delivery, 
quantity, order_id, status
```

## Field Extraction Details

### Product Name
Priority order:
1. LLM extraction from email content
2. Platform-specific parsing ("Items Ordered", "Product Details", etc.)
3. Subject line extraction ("order of <product>")
4. First substantial line from email body

### Price
Priority order:
1. LLM extraction
2. Platform-specific patterns (Price: ₹299)
3. Currency symbol patterns (₹299, Rs. 299)
4. Keywords + numbers (Total: 299, Amount: 299)
5. Fallback: any number in text
6. Default placeholder: ₹0 (user can edit)

### Status
Priority order:
1. Subject line detection (most reliable) - **Subject override**
2. LLM extraction
3. Body text analysis
4. Default: "Ordered"

### Order ID
Priority order:
1. Platform-specific patterns (Order #, Order ID:, etc.)
2. Generic "Order" keyword patterns
3. Body text regex fallback

### Delivery Dates
- Expected delivery: From "Arriving by", "Expected delivery", "Delivery by" keywords
- Actual delivery: Only extracted if email explicitly says item was delivered
- Multiple date format support
- Falls back to email date for delivered items without explicit date

## Configuration

### Supported Platforms
The system supports extraction from:
- Amazon.in & Amazon.com
- Flipkart
- Myntra
- Ajio
- Nykaa
- Tira (Reliance beauty)
- Meesho
- Generic/Unknown platforms

### Email Senders List
Updated `ECOM_SENDERS` list includes official sender addresses from all major platforms.

### Status Values
- `Ordered`: Order confirmed but not yet shipped
- `Shipped`: Order dispatched, in transit
- `Out for Delivery`: With delivery partner, arriving soon
- `Delivered`: Item received by customer
- `Cancelled`: Order cancelled
- `Returned`: Item returned by customer
- `Exchanged`: Item exchanged for another

## Testing

The improvements have been designed to pass existing tests:
- `/api/parse/text` endpoint with various email formats
- `/api/ocr/order` endpoint with screenshots
- Status extraction accuracy tests
- Date parsing tests

## Error Handling

- Graceful fallbacks if LLM fails or is not available
- Defaults to safe values (e.g., ₹0 for missing price)
- Deduplication prevents duplicate orders from multiple emails
- Parse errors are captured and logged

## Future Improvements

1. Machine learning-based field extraction
2. Image-based OCR for screenshots
3. Receipt PDF parsing
4. More regional e-commerce platforms (Snapdeal, ShopClues, etc.)
5. Category detection from product descriptions
6. Return deadline calculation (currently 30 days default)
7. Integration with merchant APIs for real-time order updates

## Notes

- The system prefers deterministic, reliable extraction over speculative parsing
- Email subject lines are treated as the most reliable status indicator
- Platform-specific extraction is very accurate but only used when platform is detected
- Generic patterns serve as comprehensive fallback for unknown platforms
- All date outputs are in ISO format (YYYY-MM-DD) for consistency

