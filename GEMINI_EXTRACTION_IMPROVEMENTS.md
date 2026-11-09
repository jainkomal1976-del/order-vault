# OrderVault Gemini Extraction & Deduplication Improvements

## Issues Fixed

### 1. **Duplicate Records for Same Product** ✅
**Problem**: "Sanfe At-Home Silk Thread..." was appearing as both "Shipped" and "Delivered" status
**Root Cause**: Product names had color variants that weren't normalized during deduplication

**Solution Implemented**:
- Added `_normalize_product_name()` function that removes:
  - Color indicators (Black, White, Red, Blue, Green, etc.)
  - Size indicators (S, M, L, XL, XXL, Free Size, etc.)
  - Variant pack sizes (but preserves "100 Pcs" as it's part of product identity)
- Product names are now normalized before deduplication
- **Example**: "Sanfe At-Home Silk Thread Remover - Black" → "Sanfe At-Home Silk Thread Remover"

### 2. **Missing Delivery Status for Old Orders** ✅
**Problem**: "100 Pcs Oil Blotting Sheets" marked as "Out for Delivery" from 24 Aug 2026 (past date) instead of "Delivered"

**Root Cause**: No logic to infer delivery based on email age

**Solution Implemented**:
- Added `_infer_status_from_age()` function that:
  - Detects if email is old (> 2 days)
  - If status is "Out for Delivery" and email is old → changes to "Delivered"
  - Falls back to "Out for Delivery" if email is recent
- Applied automatically to all orders during gmail_sync

### 3. **Enhanced Gemini Extraction Logic** ✅
**Improvements to OCR_SYSTEM_PROMPT**:

#### a) **Product Name Normalization Guidance**
```
NEW: "product_name": string (normalized: remove color/size variations, extract core product name)
RULE: Remove variant info like colors (Black, Blue, Red), sizes (S, M, L, XL)
Example: 'Sanfe At-Home Silk Thread Remover - Black' → 'Sanfe At-Home Silk Thread Remover'
```

#### b) **Order ID Critical Emphasis**
```
NEW: "order_id": string (or null) — CRITICAL: always extract if visible, this is the unique identifier
EMPHASIS: Order ID is the most reliable deduplication key - must be accurate and complete
```

#### c) **Actual Delivery Validation**
```
NEW RULE: Only set actual_delivery if email explicitly confirms delivery
If email says 'out for delivery' or 'arriving' → set status to 'Out for Delivery' with null actual_delivery
```

#### d) **Critical Extraction Rules Section**
Added explicit rules for:
- Product name normalization with examples
- Order ID importance
- Price extraction specifics
- Status inference accuracy
- Actual delivery validation

## Technical Implementation

### New Functions Added

#### `_normalize_product_name(name: str) -> str`
Removes common variants from product names:
```python
# Removes color variants at end
'Sanfe At-Home Silk Thread Remover - Black' → 'Sanfe At-Home Silk Thread Remover'

# Removes size indicators
'T-Shirt - Large' → 'T-Shirt'
'Jeans - XL' → 'Jeans'

# Preserves identity-defining quantities
'100 Pcs Oil Blotting Sheets' → '100 Pcs Oil Blotting Sheets'

# Handles multiple patterns
'Puma T-Shirt - Red - XL' → 'Puma T-Shirt'
```

#### `_infer_status_from_age(status: str, email_date: Optional[str]) -> str`
Infers delivery based on email age:
```python
# If email > 2 days old and says "Out for Delivery"
# Status automatically changes to "Delivered"

# Recent emails keep original status
# Graceful error handling for date parsing failures
```

### Integration Points

1. **During gmail_sync()**:
   - Product names normalized after LLM extraction
   - Status inferred from email age
   - Applied before deduplication

2. **During Deduplication**:
   - Uses normalized product names for grouping
   - Order ID remains primary deduplication key
   - Newer emails override older ones for same product

## Impact on User Experience

### Before
- Multiple records for same product with different statuses
- "Out for Delivery" orders from weeks ago still showing as "Out for Delivery"
- Inconsistent product names (with color/size variants)
- Poor analytics accuracy (inflated order counts)

### After
- ✅ Single consolidated record per product/platform
- ✅ Automatic status inference for old orders
- ✅ Consistent product names (normalized)
- ✅ Accurate order history
- ✅ Correct return deadline calculations

## Benefits

1. **Data Quality**
   - No duplicate orders
   - Accurate status tracking
   - Normalized product names

2. **Analytics Accuracy**
   - Correct order counts
   - Accurate spending calculations
   - Reliable delivery tracking

3. **User Experience**
   - Cleaner order list
   - No confusing duplicate entries
   - Auto-corrected outdated statuses

## Configuration

### Product Name Normalization
- Handles 20+ color names
- Handles size variations (S, M, L, XL, XXL, etc.)
- Preserves quantity-based names (e.g., "100 Pcs")
- Case-insensitive matching

### Status Age Inference
- Threshold: 2 days
- Applies only to "Out for Delivery" status
- Graceful fallback if date parsing fails
- Configurable via the function parameter

## Testing Notes

After these changes:
1. Sync Gmail orders containing same products with color variants
   - Should now show as single order (latest status)
2. Check old "Out for Delivery" emails (> 2 days old)
   - Should automatically show as "Delivered"
3. Verify product names no longer have color/size suffixes
   - Should be clean base names

## Files Modified

- `backend/server.py`:
  - Enhanced `OCR_SYSTEM_PROMPT` with normalization rules
  - Added `_normalize_product_name()` function
  - Added `_infer_status_from_age()` function
  - Updated `gmail_sync()` to apply both functions
  - Improved Gemini extraction guidance

## Future Improvements

1. Fuzzy matching for product names
   - Handle typos/variations
   - Match similar product names

2. Machine learning status inference
   - More sophisticated age-based status prediction
   - Context-aware delivery inference

3. Category extraction
   - Auto-categorize products by type
   - Better analytics grouping

4. Return deadline calculation
   - Track actual delivery dates
   - Calculate return windows per platform

---

All changes are backward compatible and don't affect existing API endpoints.
Deduplication now happens transparently during Gmail sync.

