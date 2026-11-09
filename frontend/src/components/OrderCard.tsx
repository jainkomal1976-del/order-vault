import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Order, PLATFORM_COLORS } from "@/src/constants";
import { useOrders } from "@/src/context/OrderContext";
import PlatformAvatar from "./PlatformAvatar";
import StatusBadge from "./StatusBadge";
import { formatDate, formatINR, returnDaysLeft } from "@/src/utils/orderHelpers";

interface Props {
  order: Order;
}

export default function OrderCard({ order }: Props) {
  const { colors } = useOrders();
  const router = useRouter();
  const accent = PLATFORM_COLORS[order.platform];
  const daysLeft = returnDaysLeft(order);
  const showReturnBadge =
    daysLeft !== null &&
    daysLeft >= 0 &&
    daysLeft <= 30 &&
    order.status === "Delivered";

  return (
    <Pressable
      testID={`order-card-${order.id}`}
      onPress={() => router.push(`/order/${order.id}`)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.row}>
          {order.product_image ? (
            <Image
              source={{ uri: order.product_image }}
              style={styles.thumb}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <PlatformAvatar platform={order.platform} size={44} />
          )}
          <View style={styles.info}>
            <Text
              numberOfLines={2}
              style={[styles.name, { color: colors.onSurfaceSecondary }]}
            >
              {order.product_name || "(Untitled)"}
            </Text>
            <View style={styles.metaRow}>
              <Text style={[styles.meta, { color: accent, fontWeight: "600" }]}>
                {order.platform}
              </Text>
              <Text style={[styles.metaDot, { color: colors.info }]}>·</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>
                {formatDate(order.order_date)}
              </Text>
            </View>
          </View>
          <View style={styles.priceCol}>
            <Text style={[styles.price, { color: colors.onSurfaceSecondary }]}>
              {formatINR(order.price * (order.quantity || 1))}
            </Text>
            {order.quantity > 1 ? (
              <Text style={[styles.qty, { color: colors.muted }]}>
                x{order.quantity}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.footer}>
          <StatusBadge status={order.status} />
          {showReturnBadge ? (
            <View
              testID={`return-badge-${order.id}`}
              style={[
                styles.returnBadge,
                {
                  backgroundColor:
                    daysLeft! <= 3
                      ? colors.error + "22"
                      : colors.warning + "22",
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={12}
                color={daysLeft! <= 3 ? colors.error : colors.warning}
              />
              <Text
                style={[
                  styles.returnText,
                  {
                    color: daysLeft! <= 3 ? colors.error : colors.warning,
                  },
                ]}
              >
                {daysLeft} {daysLeft === 1 ? "day" : "days"} to return
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 10,
  },
  accent: { width: 4 },
  body: { flex: 1, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#00000010" },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: 4 },
  meta: { fontSize: 12 },
  metaDot: { fontSize: 12 },
  priceCol: { alignItems: "flex-end" },
  price: { fontSize: 15, fontWeight: "700" },
  qty: { fontSize: 11, marginTop: 2 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 8,
    flexWrap: "wrap",
  },
  returnBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  returnText: { fontSize: 11, fontWeight: "600" },
});
