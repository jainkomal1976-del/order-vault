import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useOrders } from "@/src/context/OrderContext";
import {
  ORDER_STATUSES,
  OrderStatus,
  PLATFORM_COLORS,
  STATUS_TIMELINE,
} from "@/src/constants";
import PlatformAvatar from "@/src/components/PlatformAvatar";
import StatusBadge from "@/src/components/StatusBadge";
import ToastModal from "@/src/components/ToastModal";
import {
  formatDate,
  formatINR,
  returnDaysLeft,
  todayISO,
} from "@/src/utils/orderHelpers";

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getOrder, updateOrder, deleteOrder, colors } = useOrders();
  const router = useRouter();
  const order = getOrder(String(id));

  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(order?.notes || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    msg?: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });

  if (!order) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: colors.surface }]}
        edges={["top"]}
      >
        <View style={styles.center}>
          <Text style={{ color: colors.onSurface, fontSize: 16 }}>
            Order not found
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[
              styles.backBtnBig,
              { backgroundColor: colors.brandPrimary },
            ]}
          >
            <Text style={{ color: colors.onBrandPrimary, fontWeight: "600" }}>
              Go back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const accent = PLATFORM_COLORS[order.platform];
  const daysLeft = returnDaysLeft(order);

  const timelineIndex = STATUS_TIMELINE.indexOf(order.status as OrderStatus);
  // Terminal states that override the timeline
  const isTerminal =
    order.status === "Cancelled" ||
    order.status === "Returned" ||
    order.status === "Exchanged";

  const setStatus = async (s: OrderStatus) => {
    await updateOrder(order.id, { status: s });
    setToast({
      visible: true,
      title: `Marked ${s}`,
      tone: "success",
    });
  };

  const saveNotes = async () => {
    await updateOrder(order.id, { notes });
    setEditing(false);
    setToast({ visible: true, title: "Notes saved", tone: "success" });
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header bar */}
        <View style={styles.headerBar}>
          <Pressable
            testID="back-btn"
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.onSurface }]}>
            Order
          </Text>
          <Pressable
            testID="delete-order-btn"
            onPress={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3500);
                setToast({
                  visible: true,
                  title: "Tap delete again to confirm",
                  tone: "info",
                });
                return;
              }
              await deleteOrder(order.id);
              router.replace("/(tabs)");
            }}
            style={styles.iconBtn}
          >
            <Ionicons
              name={confirmDelete ? "trash" : "trash-outline"}
              size={20}
              color={colors.error}
            />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Hero */}
          <View style={styles.hero}>
            {order.product_image ? (
              <Image
                source={{ uri: order.product_image }}
                style={styles.heroImg}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.heroImg,
                  {
                    backgroundColor: accent + "22",
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                <PlatformAvatar platform={order.platform} size={72} />
              </View>
            )}
            <View style={styles.heroBody}>
              <Text style={[styles.platformTag, { color: accent }]}>
                {order.platform.toUpperCase()}
              </Text>
              <Text
                style={[styles.title, { color: colors.onSurface }]}
                numberOfLines={3}
              >
                {order.product_name}
              </Text>
              <View style={styles.rowInline}>
                <Text style={[styles.price, { color: colors.onSurface }]}>
                  {formatINR(order.price * (order.quantity || 1))}
                </Text>
                {order.quantity > 1 ? (
                  <Text style={[styles.qty, { color: colors.muted }]}>
                    × {order.quantity}
                  </Text>
                ) : null}
              </View>
              <View style={{ marginTop: 8 }}>
                <StatusBadge status={order.status} size="md" />
              </View>
            </View>
          </View>

          {/* Return deadline badge */}
          {daysLeft !== null && order.status === "Delivered" ? (
            <View
              style={[
                styles.returnBanner,
                {
                  backgroundColor:
                    daysLeft < 0
                      ? colors.info + "22"
                      : daysLeft <= 3
                      ? colors.error + "22"
                      : daysLeft <= 7
                      ? colors.warning + "22"
                      : colors.success + "22",
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={16}
                color={
                  daysLeft < 0
                    ? colors.info
                    : daysLeft <= 3
                    ? colors.error
                    : daysLeft <= 7
                    ? colors.warning
                    : colors.success
                }
              />
              <Text
                style={[
                  styles.returnBannerText,
                  {
                    color:
                      daysLeft < 0
                        ? colors.info
                        : daysLeft <= 3
                        ? colors.error
                        : daysLeft <= 7
                        ? colors.warning
                        : colors.success,
                  },
                ]}
              >
                {daysLeft < 0
                  ? "Return window closed"
                  : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to return`}
                {order.return_deadline
                  ? `  ·  by ${formatDate(order.return_deadline)}`
                  : ""}
              </Text>
            </View>
          ) : null}

          {/* Quick actions */}
          <View style={styles.actions}>
            <QuickAction
              testID="mark-delivered-btn"
              label="Mark Delivered"
              icon="checkmark-done"
              disabled={order.status === "Delivered"}
              onPress={() => setStatus("Delivered")}
            />
            <QuickAction
              testID="mark-shipped-btn"
              label="Mark Shipped"
              icon="cube"
              disabled={
                order.status === "Shipped" ||
                order.status === "Delivered" ||
                isTerminal
              }
              onPress={() => setStatus("Shipped")}
            />
            <QuickAction
              testID="mark-returned-btn"
              label="Mark Returned"
              icon="return-up-back"
              disabled={order.status === "Returned"}
              onPress={() => setStatus("Returned")}
            />
          </View>

          {/* Timeline */}
          <SectionTitle title="Status timeline" />
          <View
            style={[
              styles.timelineCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            {STATUS_TIMELINE.map((s, idx) => {
              const reached =
                !isTerminal && timelineIndex >= idx && timelineIndex !== -1;
              const isActive =
                !isTerminal && timelineIndex === idx;
              const isLast = idx === STATUS_TIMELINE.length - 1;
              return (
                <View key={s} style={styles.tlRow}>
                  <View style={styles.tlLeftCol}>
                    <View
                      style={[
                        styles.tlDot,
                        {
                          backgroundColor: reached
                            ? isActive
                              ? accent
                              : colors.success
                            : colors.surfaceTertiary,
                          borderColor: reached ? accent : colors.border,
                        },
                      ]}
                    >
                      {reached ? (
                        <Ionicons
                          name={isActive ? "ellipse" : "checkmark"}
                          size={12}
                          color="#fff"
                        />
                      ) : null}
                    </View>
                    {!isLast ? (
                      <View
                        style={[
                          styles.tlLine,
                          {
                            backgroundColor:
                              !isTerminal && timelineIndex > idx
                                ? colors.success
                                : colors.border,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, paddingVertical: 4 }}>
                    <Text
                      style={{
                        color: reached
                          ? colors.onSurfaceSecondary
                          : colors.muted,
                        fontWeight: isActive ? "700" : "500",
                        fontSize: 14,
                      }}
                    >
                      {s}
                    </Text>
                    {s === "Delivered" && order.actual_delivery ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {formatDate(order.actual_delivery)}
                      </Text>
                    ) : null}
                    {s === "Ordered" && order.order_date ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {formatDate(order.order_date)}
                      </Text>
                    ) : null}
                    {s === "Out for Delivery" &&
                    order.expected_delivery &&
                    order.status !== "Delivered" ? (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        exp. {formatDate(order.expected_delivery)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {isTerminal ? (
              <View style={[styles.tlRow, { marginTop: 4 }]}>
                <View style={styles.tlLeftCol}>
                  <View
                    style={[
                      styles.tlDot,
                      {
                        backgroundColor: colors.error,
                        borderColor: colors.error,
                      },
                    ]}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </View>
                </View>
                <View style={{ flex: 1, paddingVertical: 4 }}>
                  <Text
                    style={{ color: colors.error, fontWeight: "700" }}
                  >
                    {order.status}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Status picker */}
          <SectionTitle title="Update status" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {ORDER_STATUSES.map((s) => {
              const sel = order.status === s;
              return (
                <Pressable
                  key={s}
                  testID={`status-select-${s.replace(/\s+/g, "-").toLowerCase()}`}
                  onPress={() => setStatus(s)}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: sel
                        ? colors.brandPrimary
                        : colors.surfaceSecondary,
                      borderColor: sel ? colors.brandPrimary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: sel ? colors.onBrandPrimary : colors.onSurfaceSecondary,
                      fontWeight: "600",
                      fontSize: 13,
                    }}
                  >
                    {s}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Details */}
          <SectionTitle title="Details" />
          <View
            style={[
              styles.detailCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <DetailRow label="Category" value={order.category} />
            <DetailRow label="Order date" value={formatDate(order.order_date)} />
            <DetailRow
              label="Expected delivery"
              value={formatDate(order.expected_delivery)}
            />
            <DetailRow
              label="Actual delivery"
              value={formatDate(order.actual_delivery)}
            />
            <DetailRow
              label="Return deadline"
              value={formatDate(order.return_deadline)}
            />
            <DetailRow label="Order ID" value={order.order_id || "—"} />
            <DetailRow
              label="Payment"
              value={order.payment_method || "—"}
              last
            />
          </View>

          {/* Notes */}
          <View style={styles.notesHeader}>
            <Text style={[styles.sectionTitleText, { color: colors.muted }]}>
              NOTES
            </Text>
            <Pressable
              testID="edit-notes-btn"
              onPress={() => {
                if (editing) saveNotes();
                else setEditing(true);
              }}
            >
              <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>
                {editing ? "Save" : "Edit"}
              </Text>
            </Pressable>
          </View>
          <View
            style={[
              styles.notesCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            {editing ? (
              <TextInput
                testID="notes-input"
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Add notes…"
                placeholderTextColor={colors.muted}
                style={{
                  color: colors.onSurfaceSecondary,
                  fontSize: 14,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
              />
            ) : (
              <Text
                style={{
                  color: order.notes ? colors.onSurfaceSecondary : colors.muted,
                  fontSize: 14,
                }}
              >
                {order.notes || "No notes yet."}
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

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

function QuickAction({
  label,
  icon,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  icon: any;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useOrders();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.quickBtn,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={colors.onSurfaceSecondary}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: colors.onSurfaceSecondary,
          marginTop: 4,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ title }: { title: string }) {
  const { colors } = useOrders();
  return (
    <Text
      style={[
        styles.sectionTitleText,
        { color: colors.muted, paddingHorizontal: 16 },
      ]}
    >
      {title.toUpperCase()}
    </Text>
  );
}

function DetailRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const { colors } = useOrders();
  return (
    <View style={styles.detailRow}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{
          color: colors.onSurfaceSecondary,
          fontSize: 14,
          fontWeight: "600",
          maxWidth: "60%",
          textAlign: "right",
        }}
      >
        {value}
      </Text>
      {!last ? (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.divider,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  backBtnBig: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  headerBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  hero: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 14,
  },
  heroImg: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: "#00000010",
  },
  heroBody: { flex: 1 },
  platformTag: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  title: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  rowInline: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 6 },
  price: { fontSize: 20, fontWeight: "700" },
  qty: { fontSize: 13, marginBottom: 2 },
  returnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  returnBannerText: { fontSize: 13, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginTop: 16,
  },
  quickBtn: {
    flex: 1,
    minHeight: 68,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  sectionTitleText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 8,
  },
  chipRow: { paddingHorizontal: 16, gap: 8 },
  pill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  timelineCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tlRow: { flexDirection: "row" },
  tlLeftCol: { width: 24, alignItems: "center", marginRight: 12 },
  tlDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  tlLine: {
    width: 2,
    flex: 1,
    minHeight: 24,
    marginTop: 2,
  },
  detailCard: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  detailRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  notesCard: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
