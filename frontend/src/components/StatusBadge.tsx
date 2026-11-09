import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { OrderStatus } from "@/src/constants";
import { useOrders } from "@/src/context/OrderContext";

interface Props {
  status: OrderStatus;
  size?: "sm" | "md";
}

export default function StatusBadge({ status, size = "sm" }: Props) {
  const { colors } = useOrders();
  const map: Record<OrderStatus, { bg: string; fg: string }> = {
    Ordered: { bg: colors.surfaceTertiary, fg: colors.onSurfaceTertiary },
    Shipped: { bg: "#2874F033", fg: "#2874F0" },
    "Out for Delivery": { bg: colors.warning + "33", fg: colors.warning },
    Delivered: { bg: colors.success + "33", fg: colors.success },
    Returned: { bg: colors.info + "33", fg: colors.info },
    Exchanged: { bg: colors.info + "33", fg: colors.info },
    Cancelled: { bg: colors.error + "33", fg: colors.error },
  };
  const { bg, fg } = map[status];
  const pad = size === "md" ? 8 : 6;
  const font = size === "md" ? 13 : 11;
  return (
    <View
      testID={`status-badge-${status.replace(/\s+/g, "-").toLowerCase()}`}
      style={[styles.badge, { backgroundColor: bg, paddingHorizontal: pad + 2, paddingVertical: pad - 2 }]}
    >
      <Text style={[styles.text, { color: fg, fontSize: font }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  text: { fontWeight: "600" },
});
