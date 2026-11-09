import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance } from "react-native";
import { storage } from "@/src/utils/storage";
import { Order, PLATFORM_RETURN_DAYS, PlatformName, Category } from "@/src/constants";
import { ThemeColors, themes, ThemeMode } from "@/src/theme";

const ORDERS_KEY = "ordervault.orders.v1";
const THEME_KEY = "ordervault.theme.v1"; // "system" | "light" | "dark"

type ThemePref = "system" | "light" | "dark";

export interface PrefillFields {
  product_name?: string;
  price?: number;
  platform?: PlatformName;
  order_date?: string;
  quantity?: number;
  order_id?: string;
  category?: Category;
}

interface OrderContextValue {
  orders: Order[];
  loading: boolean;
  addOrder: (o: Omit<Order, "id" | "created_at" | "updated_at">) => Promise<Order>;
  updateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  getOrder: (id: string) => Order | undefined;
  clearAll: () => Promise<void>;
  // theme
  themePref: ThemePref;
  setThemePref: (p: ThemePref) => Promise<void>;
  mode: ThemeMode;
  colors: ThemeColors;
  // one-shot handoff of parsed fields → Add screen
  pendingPrefill: PrefillFields | null;
  setPendingPrefill: (p: PrefillFields | null) => void;
  consumePendingPrefill: () => PrefillFields | null;
}

const OrderContext = createContext<OrderContextValue | null>(null);

export function computeReturnDeadline(
  platform: Order["platform"],
  actualDeliveryISO?: string,
  expectedDeliveryISO?: string,
): string | undefined {
  const base = actualDeliveryISO || expectedDeliveryISO;
  if (!base) return undefined;
  const days = PLATFORM_RETURN_DAYS[platform] ?? 7;
  const d = new Date(base);
  if (isNaN(d.getTime())) return undefined;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [themePref, setThemePrefState] = useState<ThemePref>("system");
  const [systemScheme, setSystemScheme] = useState<ThemeMode>(
    (Appearance.getColorScheme() as ThemeMode) || "light",
  );

  // Load persisted state
  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<string>(ORDERS_KEY, "");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Order[];
          if (Array.isArray(parsed)) setOrders(parsed);
        } catch {
          // ignore
        }
      }
      const tp = await storage.getItem<string>(THEME_KEY, "system");
      if (tp === "light" || tp === "dark" || tp === "system") {
        setThemePrefState(tp);
      }
      setLoading(false);
    })();
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme((colorScheme as ThemeMode) || "light");
    });
    return () => sub.remove();
  }, []);

  const persist = useCallback(async (next: Order[]) => {
    await storage.setItem(ORDERS_KEY, JSON.stringify(next));
  }, []);

  const addOrder = useCallback<OrderContextValue["addOrder"]>(
    async (o) => {
      const now = new Date().toISOString();
      const newOrder: Order = {
        ...o,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        created_at: now,
        updated_at: now,
      };
      if (!newOrder.return_deadline) {
        newOrder.return_deadline = computeReturnDeadline(
          newOrder.platform,
          newOrder.actual_delivery,
          newOrder.expected_delivery,
        );
      }
      const next = [newOrder, ...orders];
      setOrders(next);
      await persist(next);
      return newOrder;
    },
    [orders, persist],
  );

  const updateOrder = useCallback<OrderContextValue["updateOrder"]>(
    async (id, patch) => {
      const next = orders.map((o) => {
        if (o.id !== id) return o;
        const merged: Order = {
          ...o,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        // Auto-fill actual_delivery when marked Delivered
        if (patch.status === "Delivered" && !merged.actual_delivery) {
          merged.actual_delivery = new Date().toISOString().slice(0, 10);
        }
        // Recompute return deadline if delivery or platform changed
        if (
          patch.actual_delivery !== undefined ||
          patch.expected_delivery !== undefined ||
          patch.platform !== undefined ||
          patch.status === "Delivered"
        ) {
          merged.return_deadline = computeReturnDeadline(
            merged.platform,
            merged.actual_delivery,
            merged.expected_delivery,
          );
        }
        return merged;
      });
      setOrders(next);
      await persist(next);
    },
    [orders, persist],
  );

  const deleteOrder = useCallback<OrderContextValue["deleteOrder"]>(
    async (id) => {
      const next = orders.filter((o) => o.id !== id);
      setOrders(next);
      await persist(next);
    },
    [orders, persist],
  );

  const getOrder = useCallback(
    (id: string) => orders.find((o) => o.id === id),
    [orders],
  );

  const clearAll = useCallback(async () => {
    setOrders([]);
    await persist([]);
  }, [persist]);

  const setThemePref = useCallback(async (p: ThemePref) => {
    setThemePrefState(p);
    await storage.setItem(THEME_KEY, p);
  }, []);

  const [pendingPrefill, setPendingPrefillState] = useState<PrefillFields | null>(null);
  const setPendingPrefill = useCallback((p: PrefillFields | null) => {
    setPendingPrefillState(p);
  }, []);
  const consumePendingPrefill = useCallback(() => {
    const v = pendingPrefill;
    setPendingPrefillState(null);
    return v;
  }, [pendingPrefill]);

  const mode: ThemeMode =
    themePref === "system" ? systemScheme : (themePref as ThemeMode);

  const value = useMemo<OrderContextValue>(
    () => ({
      orders,
      loading,
      addOrder,
      updateOrder,
      deleteOrder,
      getOrder,
      clearAll,
      themePref,
      setThemePref,
      mode,
      colors: themes[mode],
      pendingPrefill,
      setPendingPrefill,
      consumePendingPrefill,
    }),
    [
      orders,
      loading,
      addOrder,
      updateOrder,
      deleteOrder,
      getOrder,
      clearAll,
      themePref,
      setThemePref,
      mode,
      pendingPrefill,
      setPendingPrefill,
      consumePendingPrefill,
    ],
  );

  return (
    <OrderContext.Provider value={value}>{children}</OrderContext.Provider>
  );
}

export function useOrders() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrders must be used within OrderProvider");
  return ctx;
}
