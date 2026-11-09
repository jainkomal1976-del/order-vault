import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BarChart, PieChart } from "react-native-gifted-charts";
import { Ionicons } from "@expo/vector-icons";
import { useOrders } from "@/src/context/OrderContext";
import {
  CATEGORY_COLORS,
  Category,
  PLATFORMS,
  PLATFORM_COLORS,
  PlatformName,
} from "@/src/constants";
import { formatINR, isCurrentMonth } from "@/src/utils/orderHelpers";

const { width } = Dimensions.get("window");

export default function AnalyticsScreen() {
  const { orders, colors } = useOrders();

  const {
    totalSpend,
    orderCount,
    monthSpend,
    platformSpend,
    categorySpend,
    topPlatform,
  } = useMemo(() => {
    let totalSpend = 0;
    let monthSpend = 0;
    const platformSpend: Record<string, number> = {};
    const categorySpend: Record<string, number> = {};
    for (const o of orders) {
      const line = o.price * (o.quantity || 1);
      totalSpend += line;
      if (isCurrentMonth(o.order_date)) monthSpend += line;
      platformSpend[o.platform] = (platformSpend[o.platform] || 0) + line;
      categorySpend[o.category] = (categorySpend[o.category] || 0) + line;
    }
    const orderCount = orders.length;
    let topPlatform: string | null = null;
    let topCount = 0;
    const pcount: Record<string, number> = {};
    for (const o of orders) {
      pcount[o.platform] = (pcount[o.platform] || 0) + 1;
      if (pcount[o.platform] > topCount) {
        topCount = pcount[o.platform];
        topPlatform = o.platform;
      }
    }
    return {
      totalSpend,
      orderCount,
      monthSpend,
      platformSpend,
      categorySpend,
      topPlatform,
    };
  }, [orders]);

  const barData = useMemo(() => {
    return PLATFORMS.filter((p) => (platformSpend[p] || 0) > 0).map(
      (p: PlatformName) => ({
        value: Math.round(platformSpend[p] || 0),
        label: p.slice(0, 4),
        frontColor: PLATFORM_COLORS[p],
        topLabelComponent: () => (
          <Text style={{ color: colors.muted, fontSize: 9, marginBottom: 2 }}>
            {formatINR(platformSpend[p] || 0)}
          </Text>
        ),
      }),
    );
  }, [platformSpend, colors.muted]);

  const pieData = useMemo(() => {
    const entries = (Object.keys(categorySpend) as Category[])
      .filter((c) => categorySpend[c] > 0)
      .map((c) => ({
        value: categorySpend[c],
        color: CATEGORY_COLORS[c],
        text: c,
      }));
    return entries;
  }, [categorySpend]);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.headerPad}>
          <Text style={[styles.h1, { color: colors.onSurface }]}>Analytics</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Insights on your spending
          </Text>
        </View>

        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={64} color={colors.muted} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>
              No data yet
            </Text>
            <Text style={[styles.emptyMsg, { color: colors.muted }]}>
              Add orders to see your spending insights.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <BigStat label="Total spend" value={formatINR(totalSpend)} />
              <BigStat label="This month" value={formatINR(monthSpend)} />
            </View>
            <View style={styles.statsRow}>
              <BigStat label="Orders" value={String(orderCount)} />
              <BigStat label="Top platform" value={topPlatform || "—"} />
            </View>

            {/* Bar Chart */}
            <Card title="Spend by platform">
              {barData.length > 0 ? (
                <BarChart
                  data={barData}
                  barWidth={26}
                  spacing={18}
                  roundedTop
                  hideRules
                  xAxisColor={colors.border}
                  yAxisColor={colors.border}
                  yAxisTextStyle={{ color: colors.muted, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: colors.muted, fontSize: 10 }}
                  noOfSections={4}
                  height={180}
                  initialSpacing={12}
                  width={width - 80}
                />
              ) : (
                <Text style={{ color: colors.muted }}>No spend recorded.</Text>
              )}
            </Card>

            {/* Pie */}
            <Card title="Spend by category">
              {pieData.length > 0 ? (
                <View style={{ alignItems: "center" }}>
                  <PieChart
                    data={pieData}
                    donut
                    radius={90}
                    innerRadius={55}
                    innerCircleColor={colors.surfaceSecondary}
                    centerLabelComponent={() => (
                      <View style={{ alignItems: "center" }}>
                        <Text
                          style={{
                            color: colors.onSurfaceSecondary,
                            fontWeight: "700",
                            fontSize: 14,
                          }}
                        >
                          {formatINR(totalSpend)}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10 }}>
                          Total
                        </Text>
                      </View>
                    )}
                  />
                  <View style={styles.legend}>
                    {pieData.map((e) => (
                      <View key={e.text as string} style={styles.legendItem}>
                        <View
                          style={[styles.legendDot, { backgroundColor: e.color }]}
                        />
                        <Text
                          style={{
                            color: colors.onSurfaceSecondary,
                            fontSize: 12,
                          }}
                        >
                          {e.text} — {formatINR(e.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <Text style={{ color: colors.muted }}>No category data.</Text>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  const { colors } = useOrders();
  return (
    <View
      style={[
        styles.big,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.bigLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.bigValue, { color: colors.onSurfaceSecondary }]}>
        {value}
      </Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useOrders();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.cardTitle, { color: colors.onSurfaceSecondary }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerPad: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  h1: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 10,
  },
  big: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  bigLabel: { fontSize: 11, fontWeight: "600" },
  bigValue: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 12 },
  legend: { marginTop: 12, gap: 6, alignSelf: "stretch" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 999 },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 12 },
  emptyMsg: { fontSize: 14, marginTop: 4, textAlign: "center" },
});
