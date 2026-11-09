import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { useOrders } from "@/src/context/OrderContext";
import { useGmail } from "@/src/context/GmailContext";
import { Order, PLATFORMS, ORDER_STATUSES } from "@/src/constants";
import FilterChipsRow, { ChipItem } from "@/src/components/FilterChipsRow";
import OrderCard from "@/src/components/OrderCard";
import ToastModal from "@/src/components/ToastModal";
import {
  formatINR,
  isCurrentMonth,
  isInTransit,
  returnDaysLeft,
} from "@/src/utils/orderHelpers";

const PLATFORM_CHIPS: ChipItem[] = [
  { label: "All", value: "All" },
  ...PLATFORMS.map((p) => ({ label: p, value: p })),
];

const STATUS_CHIPS: ChipItem[] = [
  { label: "Any status", value: "All" },
  ...ORDER_STATUSES.map((s) => ({ label: s, value: s })),
];

export default function HomeScreen() {
  const { orders, colors, loading } = useOrders();
  const { gmail } = useGmail();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<string>("All");
  const [status, setStatus] = useState<string>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    msg?: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });

  const syncNow = async () => {
    // If Gmail is connected, run Gmail sync
    if (gmail) {
      router.push("/gmail-review");
      return;
    }
    // Otherwise fall back to clipboard-based Quick Add
    try {
      const clip = await Clipboard.getStringAsync();
      const trimmed = (clip || "").trim();
      if (!trimmed || trimmed.length < 8) {
        setToast({
          visible: true,
          title: "Nothing to sync",
          msg: "Connect Gmail (Settings) or copy an order email, then tap Sync Now.",
          tone: "info",
        });
        return;
      }
      router.push({ pathname: "/quick-add", params: { text: trimmed } });
    } catch {
      router.push("/quick-add");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (platform !== "All" && o.platform !== platform) return false;
      if (status !== "All" && o.status !== status) return false;
      if (q) {
        const hay = `${o.product_name} ${o.order_id ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, query, platform, status]);

  const stats = useMemo(() => {
    const monthSpend = orders
      .filter((o) => isCurrentMonth(o.order_date))
      .reduce((sum, o) => sum + o.price * (o.quantity || 1), 0);
    const inTransit = orders.filter((o) => isInTransit(o.status)).length;
    const returnSoon = orders.filter((o) => {
      const d = returnDaysLeft(o);
      return d !== null && d >= 0 && d <= 3 && o.status === "Delivered";
    }).length;
    return { monthSpend, inTransit, returnSoon };
   }, [orders]);

   // Auto-sync Gmail every 2 hours if connected
   useEffect(() => {
     if (!gmail) return;

     const interval = setInterval(() => {
       console.log("Auto-syncing Gmail orders...");
       // Trigger a sync
       syncNow();
     }, 2 * 60 * 60 * 1000); // 2 hours

     return () => clearInterval(interval);
   }, [gmail]);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  const renderHeader = () => (
    <View>
      <View style={styles.headerPad}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: colors.onSurface }]}>OrderVault</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              All your online orders in one place
            </Text>
          </View>
          <Pressable
            testID="sync-now-btn"
            onPress={syncNow}
            style={[
              styles.syncBtn,
              {
                backgroundColor: colors.brandPrimary,
              },
            ]}
          >
            <Ionicons name="sync" size={14} color={colors.onBrandPrimary} />
            <Text
              style={[styles.syncText, { color: colors.onBrandPrimary }]}
            >
              Sync Now
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.search,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            testID="home-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Search product or order ID"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.onSurfaceSecondary }]}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Summary Cards */}
      <View style={styles.statsRow}>
        <StatCard
          label="This month"
          value={formatINR(stats.monthSpend)}
          icon="wallet-outline"
          tint={colors.brandPrimary}
        />
        <StatCard
          label="In transit"
          value={String(stats.inTransit)}
          icon="cube-outline"
          tint="#2874F0"
        />
        <StatCard
          label="Return soon"
          value={String(stats.returnSoon)}
          icon="time-outline"
          tint={colors.warning}
        />
      </View>

      {/* Filter Chip Rows */}
      <FilterChipsRow
        items={PLATFORM_CHIPS}
        selected={platform}
        onSelect={setPlatform}
        testIDPrefix="platform-chip"
      />
      <FilterChipsRow
        items={STATUS_CHIPS}
        selected={status}
        onSelect={setStatus}
        testIDPrefix="status-chip"
      />

      <View style={styles.listHeader}>
        <Text style={[styles.listHeaderText, { color: colors.muted }]}>
          {filtered.length} {filtered.length === 1 ? "order" : "orders"}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <FlatList
        testID="home-order-list"
        data={filtered}
        keyExtractor={(item: Order) => item.id}
        renderItem={({ item }) => <OrderCard order={item} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={64} color={colors.muted} />
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>
                No orders yet
              </Text>
              <Text style={[styles.emptyMsg, { color: colors.muted }]}>
                Start tracking your first order.
              </Text>
              <Pressable
                testID="empty-add-order-btn"
                onPress={() => router.push("/(tabs)/add")}
                style={[
                  styles.emptyBtn,
                  { backgroundColor: colors.brandPrimary },
                ]}
              >
                <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>
                  Add Order
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      />
      <ToastModal
        visible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
        title={toast.title}
        message={toast.msg}
        tone={toast.tone}
      />
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: any;
  tint: string;
}) {
  const { colors } = useOrders();
  return (
    <View
      style={[
        styles.stat,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.statIcon, { backgroundColor: tint + "22" }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={[styles.statValue, { color: colors.onSurfaceSecondary }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerPad: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  syncText: { fontSize: 13, fontWeight: "700" },
  h1: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14 },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 4,
  },
  stat: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: { fontSize: 18, fontWeight: "700" },
  statLabel: { fontSize: 11, marginTop: 2 },
  listHeader: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
  listHeaderText: { fontSize: 12, fontWeight: "600" },
  empty: {
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 12 },
  emptyMsg: { fontSize: 14, marginTop: 4, textAlign: "center" },
  emptyBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
});
