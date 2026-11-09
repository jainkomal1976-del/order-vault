// OrderVault app-wide constants

export type PlatformName =
  | "Amazon"
  | "Flipkart"
  | "Myntra"
  | "Ajio"
  | "Nykaa"
  | "Meesho"
  | "Tira"
  | "Other";

export const PLATFORMS: PlatformName[] = [
  "Amazon",
  "Flipkart",
  "Myntra",
  "Ajio",
  "Nykaa",
  "Meesho",
  "Tira",
  "Other",
];

export const PLATFORM_COLORS: Record<PlatformName, string> = {
  Amazon: "#FF9900",
  Flipkart: "#2874F0",
  Myntra: "#FF3F6C",
  Ajio: "#E53935",
  Nykaa: "#FC2779",
  Meesho: "#9F2089",
  Tira: "#C41E3A",
  Other: "#8E8E93",
};

// Default return window in days per platform (editable per order)
export const PLATFORM_RETURN_DAYS: Record<PlatformName, number> = {
  Amazon: 10,
  Flipkart: 7,
  Myntra: 14,
  Ajio: 15,
  Nykaa: 15,
  Meesho: 7,
  Tira: 15,
  Other: 7,
};

export type Category =
  | "Clothing"
  | "Electronics"
  | "Footwear"
  | "Home"
  | "Beauty"
  | "Accessories"
  | "Other";

export const CATEGORIES: Category[] = [
  "Clothing",
  "Electronics",
  "Footwear",
  "Home",
  "Beauty",
  "Accessories",
  "Other",
];

export const CATEGORY_COLORS: Record<Category, string> = {
  Clothing: "#FF3F6C",
  Electronics: "#2874F0",
  Footwear: "#E53935",
  Home: "#34C759",
  Beauty: "#FC2779",
  Accessories: "#FF9500",
  Other: "#8E8E93",
};

export type OrderStatus =
  | "Ordered"
  | "Shipped"
  | "Out for Delivery"
  | "Delivered"
  | "Returned"
  | "Exchanged"
  | "Cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "Ordered",
  "Shipped",
  "Out for Delivery",
  "Delivered",
  "Returned",
  "Exchanged",
  "Cancelled",
];

// Timeline order (only forward-progressing statuses)
export const STATUS_TIMELINE: OrderStatus[] = [
  "Ordered",
  "Shipped",
  "Out for Delivery",
  "Delivered",
];

export type PaymentMethod = "UPI" | "Card" | "COD" | "Wallet" | "";

export const PAYMENT_METHODS: PaymentMethod[] = ["UPI", "Card", "COD", "Wallet"];

export interface Order {
  id: string;
  platform: PlatformName;
  product_name: string;
  product_image?: string; // base64 or url
  category: Category;
  order_date: string; // ISO YYYY-MM-DD
  price: number;
  quantity: number;
  order_id?: string;
  status: OrderStatus;
  expected_delivery?: string; // ISO
  actual_delivery?: string; // ISO
  payment_method?: PaymentMethod;
  notes?: string;
  return_deadline?: string; // ISO
  created_at: string; // ISO datetime
  updated_at: string; // ISO datetime
}
