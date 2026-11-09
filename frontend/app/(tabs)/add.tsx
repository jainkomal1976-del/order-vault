import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

import { useOrders, computeReturnDeadline } from "@/src/context/OrderContext";
import {
  CATEGORIES,
  Category,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PaymentMethod,
  PLATFORMS,
  PLATFORM_COLORS,
  PlatformName,
  PLATFORM_RETURN_DAYS,
  OrderStatus,
} from "@/src/constants";
import PlatformAvatar from "@/src/components/PlatformAvatar";
import ToastModal from "@/src/components/ToastModal";
import { todayISO } from "@/src/utils/orderHelpers";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function AddOrderScreen() {
  const { addOrder, colors, consumePendingPrefill } = useOrders();
  const router = useRouter();

  const [platform, setPlatform] = useState<PlatformName>("Amazon");
  const [productName, setProductName] = useState("");
  const [productImage, setProductImage] = useState<string | undefined>();
  const [category, setCategory] = useState<Category>("Clothing");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [orderId, setOrderId] = useState("");
  const [status, setStatus] = useState<OrderStatus>("Ordered");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("");
  const [notes, setNotes] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    msg?: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });

  // Consume any pending prefill (from Quick Add flow) once on mount
  useEffect(() => {
    const p = consumePendingPrefill();
    if (!p) return;
    if (p.platform) setPlatform(p.platform);
    if (p.product_name) setProductName(p.product_name);
    if (p.category) setCategory(p.category);
    if (p.order_date) setOrderDate(p.order_date);
    if (typeof p.price === "number") setPrice(String(p.price));
    if (p.quantity) setQuantity(String(p.quantity));
    if (p.order_id) setOrderId(p.order_id);
    setToast({
      visible: true,
      title: "Details prefilled",
      msg: "Review and tap Save Order.",
      tone: "success",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async (fromOCR: boolean) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setToast({
        visible: true,
        title: "Permission needed",
        msg: "Allow photo library access to add screenshots.",
        tone: "error",
      });
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const b64 = asset.base64 || "";
    const dataUri = `data:image/jpeg;base64,${b64}`;
    if (fromOCR) {
      await runOCR(b64);
      setProductImage(dataUri);
    } else {
      setProductImage(dataUri);
    }
  };

  const runOCR = async (b64: string) => {
    if (!BACKEND) return;
    setOcrLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/ocr/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: b64 }),
      });
      if (!r.ok) throw new Error(`OCR failed (${r.status})`);
      const data = await r.json();
      if (data.product_name) setProductName(data.product_name);
      if (typeof data.price === "number") setPrice(String(data.price));
      if (data.quantity) setQuantity(String(data.quantity));
      if (data.order_date) setOrderDate(data.order_date);
      if (data.order_id) setOrderId(data.order_id);
      if (data.platform && PLATFORMS.includes(data.platform)) {
        setPlatform(data.platform);
      }
      setToast({
        visible: true,
        title: "Details extracted",
        msg: "Review the fields before saving.",
        tone: "success",
      });
    } catch (e: any) {
      setToast({
        visible: true,
        title: "OCR failed",
        msg: e?.message || "Please fill in the details manually.",
        tone: "error",
      });
    } finally {
      setOcrLoading(false);
    }
  };

  const save = async () => {
    if (!productName.trim()) {
      setToast({
        visible: true,
        title: "Product name required",
        tone: "error",
      });
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      setToast({ visible: true, title: "Enter a valid price", tone: "error" });
      return;
    }
    const qty = parseInt(quantity, 10) || 1;

    const rDeadline = computeReturnDeadline(
      platform,
      undefined,
      expectedDelivery || undefined,
    );

    await addOrder({
      platform,
      product_name: productName.trim(),
      product_image: productImage,
      category,
      order_date: orderDate,
      price: priceNum,
      quantity: qty,
      order_id: orderId.trim() || undefined,
      status,
      expected_delivery: expectedDelivery || undefined,
      actual_delivery: undefined,
      payment_method: payment,
      notes: notes.trim() || undefined,
      return_deadline: rDeadline,
    });
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    }
    setToast({
      visible: true,
      title: "Order saved",
      msg: "Your order was added.",
      tone: "success",
    });
    // reset & navigate home shortly
    setTimeout(() => {
      setProductName("");
      setProductImage(undefined);
      setPrice("");
      setQuantity("1");
      setOrderId("");
      setExpectedDelivery("");
      setNotes("");
      router.push("/(tabs)");
    }, 800);
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
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerPad}>
            <Text style={[styles.h1, { color: colors.onSurface }]}>Add Order</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Under 15 seconds. Or paste a screenshot.
            </Text>
          </View>

          {/* OCR Banner */}
          <Pressable
            testID="ocr-banner"
            onPress={() => pickImage(true)}
            disabled={ocrLoading}
            style={[
              styles.ocrBanner,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.ocrIcon,
                { backgroundColor: colors.brandPrimary },
              ]}
            >
              {ocrLoading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Ionicons
                  name="sparkles"
                  size={18}
                  color={colors.onBrandPrimary}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ocrTitle, { color: colors.onSurfaceSecondary }]}>
                {ocrLoading ? "Extracting…" : "Auto-fill from screenshot"}
              </Text>
              <Text style={[styles.ocrSub, { color: colors.muted }]}>
                Powered by Gemini
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          {/* Paste-Text Banner */}
          <Pressable
            testID="paste-text-banner"
            onPress={() => router.push("/quick-add")}
            style={[
              styles.ocrBanner,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
                marginTop: 8,
              },
            ]}
          >
            <View
              style={[
                styles.ocrIcon,
                { backgroundColor: colors.surfaceTertiary },
              ]}
            >
              <Ionicons
                name="clipboard-outline"
                size={18}
                color={colors.onSurfaceTertiary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.ocrTitle, { color: colors.onSurfaceSecondary }]}
              >
                Paste order text
              </Text>
              <Text style={[styles.ocrSub, { color: colors.muted }]}>
                Email, SMS, WhatsApp forward
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          {/* Platform Selector */}
          <Section title="Platform" color={colors.muted}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.platformRow}
            >
              {PLATFORMS.map((p) => {
                const isSel = p === platform;
                return (
                  <Pressable
                    key={p}
                    testID={`platform-select-${p.toLowerCase()}`}
                    onPress={() => {
                      setPlatform(p);
                      if (Platform.OS !== "web") {
                        Haptics.selectionAsync().catch(() => {});
                      }
                    }}
                    style={styles.platformItem}
                  >
                    <View
                      style={[
                        styles.platformCircle,
                        {
                          borderColor: isSel ? PLATFORM_COLORS[p] : colors.border,
                          borderWidth: isSel ? 3 : 1,
                        },
                      ]}
                    >
                      <PlatformAvatar platform={p} size={44} />
                    </View>
                    <Text
                      style={[
                        styles.platformLabel,
                        {
                          color: isSel
                            ? colors.onSurface
                            : colors.muted,
                          fontWeight: isSel ? "700" : "500",
                        },
                      ]}
                    >
                      {p}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Section>

          {/* Product Image */}
          <Section title="Product image (optional)" color={colors.muted}>
            <View style={styles.imgRow}>
              {productImage ? (
                <View style={styles.imgPreviewWrap}>
                  <Image
                    source={{ uri: productImage }}
                    style={styles.imgPreview}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => setProductImage(undefined)}
                    style={styles.imgClear}
                    testID="clear-image-btn"
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  testID="pick-image-btn"
                  onPress={() => pickImage(false)}
                  style={[
                    styles.imgPicker,
                    { borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  <Ionicons name="image-outline" size={22} color={colors.muted} />
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                    Add image
                  </Text>
                </Pressable>
              )}
            </View>
          </Section>

          <Input
            testID="input-product-name"
            label="Product name *"
            value={productName}
            onChangeText={setProductName}
            placeholder="e.g. Nike Revolution 6 shoes"
          />

          <Row>
            <Input
              testID="input-price"
              label="Price (₹) *"
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              keyboardType="numeric"
              flex={2}
            />
            <Input
              testID="input-quantity"
              label="Qty"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="1"
              keyboardType="numeric"
              flex={1}
            />
          </Row>

          <Row>
            <Input
              testID="input-order-date"
              label="Order date"
              value={orderDate}
              onChangeText={setOrderDate}
              placeholder="YYYY-MM-DD"
              flex={1}
            />
            <Input
              testID="input-expected-delivery"
              label="Expected delivery"
              value={expectedDelivery}
              onChangeText={setExpectedDelivery}
              placeholder="YYYY-MM-DD"
              flex={1}
            />
          </Row>

          <Input
            testID="input-order-id"
            label="Order ID / tracking (optional)"
            value={orderId}
            onChangeText={setOrderId}
            placeholder="e.g. OD1234..."
          />

          {/* Category chips */}
          <Section title="Category" color={colors.muted}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {CATEGORIES.map((c) => (
                <PillButton
                  key={c}
                  testID={`category-pill-${c.toLowerCase()}`}
                  label={c}
                  selected={c === category}
                  onPress={() => setCategory(c)}
                />
              ))}
            </ScrollView>
          </Section>

          {/* Status chips */}
          <Section title="Status" color={colors.muted}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {ORDER_STATUSES.map((s) => (
                <PillButton
                  key={s}
                  testID={`status-pill-${s.replace(/\s+/g, "-").toLowerCase()}`}
                  label={s}
                  selected={s === status}
                  onPress={() => setStatus(s)}
                />
              ))}
            </ScrollView>
          </Section>

          {/* Payment */}
          <Section title="Payment method (optional)" color={colors.muted}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {PAYMENT_METHODS.map((p) => (
                <PillButton
                  key={p}
                  testID={`payment-pill-${p.toLowerCase()}`}
                  label={p}
                  selected={p === payment}
                  onPress={() => setPayment(payment === p ? "" : p)}
                />
              ))}
            </ScrollView>
          </Section>

          <Input
            testID="input-notes"
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything to remember?"
            multiline
          />

          <Text
            style={[
              styles.helper,
              { color: colors.muted, paddingHorizontal: 16, marginTop: 8 },
            ]}
          >
            Return window auto-calculated: {PLATFORM_RETURN_DAYS[platform]} days after delivery
          </Text>
        </ScrollView>

        {/* Sticky Save */}
        <View
          style={[
            styles.saveBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          <Pressable
            testID="save-order-btn"
            onPress={save}
            style={[
              styles.saveBtn,
              { backgroundColor: colors.brandPrimary },
            ]}
          >
            <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} />
            <Text
              style={[styles.saveText, { color: colors.onBrandPrimary }]}
            >
              Save Order
            </Text>
          </Pressable>
        </View>
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

// -------- Small helpers --------
function Section({
  title,
  children,
  color,
}: {
  title: string;
  children: React.ReactNode;
  color: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.rowInputs}>{children}</View>;
}

function Input({
  label,
  flex = 1,
  multiline,
  testID,
  ...rest
}: {
  label: string;
  flex?: number;
  multiline?: boolean;
  testID?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
}) {
  const { colors } = useOrders();
  return (
    <View style={{ flex, paddingHorizontal: 16, marginTop: 12 }}>
      <Text style={[styles.inputLabel, { color: colors.muted }]}>{label}</Text>
      <TextInput
        testID={testID}
        {...rest}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
            color: colors.onSurfaceSecondary,
            minHeight: multiline ? 72 : 44,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
    </View>
  );
}

function PillButton({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useOrders();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? colors.brandPrimary : colors.surfaceSecondary,
          borderColor: selected ? colors.brandPrimary : colors.border,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? colors.onBrandPrimary : colors.onSurfaceSecondary,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerPad: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  h1: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  ocrBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 8,
  },
  ocrIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  ocrTitle: { fontSize: 15, fontWeight: "600" },
  ocrSub: { fontSize: 12, marginTop: 2 },
  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  platformRow: { paddingHorizontal: 16, gap: 12, alignItems: "flex-start" },
  platformItem: { alignItems: "center", width: 64 },
  platformCircle: {
    borderRadius: 999,
    padding: 3,
  },
  platformLabel: { fontSize: 11, marginTop: 6 },
  rowInputs: { flexDirection: "row" },
  inputLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 14,
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
  helper: { fontSize: 12, marginBottom: 4 },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  saveText: { fontSize: 16, fontWeight: "700" },
  imgRow: { paddingHorizontal: 16 },
  imgPicker: {
    width: 100,
    height: 100,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  imgPreviewWrap: { position: "relative", width: 100, height: 100 },
  imgPreview: { width: 100, height: 100, borderRadius: 12 },
  imgClear: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#000000AA",
    borderRadius: 999,
    padding: 4,
  },
});
