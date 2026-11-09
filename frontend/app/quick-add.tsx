import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useOrders, PrefillFields } from "@/src/context/OrderContext";
import { PLATFORMS, PlatformName } from "@/src/constants";
import ToastModal from "@/src/components/ToastModal";
import PlatformAvatar from "@/src/components/PlatformAvatar";
import { formatINR } from "@/src/utils/orderHelpers";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

const HINTS = [
  "Amazon / Flipkart order confirmation email",
  "Shipping SMS or WhatsApp forward",
  "Copy an order link + description",
];

export default function QuickAddScreen() {
  const { colors, setPendingPrefill } = useOrders();
  const router = useRouter();
  const params = useLocalSearchParams<{ fromClipboard?: string; text?: string }>();

  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PrefillFields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });

  // Prefill from clipboard or ?text= param
  useEffect(() => {
    (async () => {
      if (params.text && !text) {
        setText(String(params.text));
        return;
      }
      if (params.fromClipboard === "1" && !text) {
        try {
          const clip = await Clipboard.getStringAsync();
          if (clip && clip.trim().length > 0) {
            setText(clip);
          } else {
            setToast({
              visible: true,
              title: "Clipboard is empty",
              tone: "info",
            });
          }
        } catch {
          // ignore
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.fromClipboard, params.text]);

  const canExtract = text.trim().length >= 8 && !loading;

  const extract = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/parse/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      const data = await r.json();
      const p: PrefillFields = {};
      if (data.product_name) p.product_name = data.product_name;
      if (typeof data.price === "number") p.price = data.price;
      if (data.platform && PLATFORMS.includes(data.platform)) {
        p.platform = data.platform as PlatformName;
      }
      if (data.order_date) p.order_date = data.order_date;
      if (data.quantity) p.quantity = Number(data.quantity);
      if (data.order_id) p.order_id = data.order_id;
      setResult(p);
      if (!p.product_name && !p.price) {
        setError("Couldn't find order details in this text. Try adding more of the email/SMS.");
      }
    } catch (e: any) {
      setError(e?.message || "Extraction failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const useResult = () => {
    if (!result) return;
    setPendingPrefill(result);
    router.replace("/(tabs)/add");
  };

  const pasteFromClipboard = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) setText(clip);
    else setToast({ visible: true, title: "Clipboard is empty", tone: "info" });
  };

  const clear = () => {
    setText("");
    setResult(null);
    setError(null);
  };

  const preview = useMemo(() => {
    if (!result) return null;
    return (
      <View
        style={[
          styles.previewCard,
          {
            backgroundColor: colors.surfaceSecondary,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.previewRow}>
          <PlatformAvatar platform={(result.platform || "Other") as PlatformName} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.previewName, { color: colors.onSurfaceSecondary }]} numberOfLines={2}>
              {result.product_name || "(No product name found)"}
            </Text>
            {result.platform ? (
              <Text style={[styles.previewMeta, { color: colors.muted }]}>{result.platform}</Text>
            ) : null}
          </View>
          {typeof result.price === "number" ? (
            <Text style={[styles.previewPrice, { color: colors.onSurfaceSecondary }]}>
              {formatINR(result.price * (result.quantity || 1))}
            </Text>
          ) : null}
        </View>
        <View style={styles.kvGrid}>
          <KV label="Qty" value={result.quantity ? String(result.quantity) : "1"} />
          <KV label="Order date" value={result.order_date || "—"} />
          <KV label="Order ID" value={result.order_id || "—"} full />
        </View>
      </View>
    );
  }, [result, colors]);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.headerBar}>
          <Pressable
            testID="qa-back-btn"
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.onSurface }]}>
            Quick Add
          </Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerPad}>
            <Text style={[styles.h1, { color: colors.onSurface }]}>
              Paste anything
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Order email, shipping SMS, WhatsApp forward — we&apos;ll extract
              the details for you.
            </Text>
          </View>

          <View style={styles.hints}>
            {HINTS.map((h) => (
              <View key={h} style={styles.hintRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={colors.success}
                />
                <Text style={[styles.hintText, { color: colors.muted }]}>{h}</Text>
              </View>
            ))}
          </View>

          {/* Text input */}
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <TextInput
              testID="qa-text-input"
              multiline
              placeholder="Paste order email, SMS or notification text here…"
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (result) setResult(null);
                if (error) setError(null);
              }}
              style={{
                color: colors.onSurfaceSecondary,
                fontSize: 14,
                minHeight: 160,
                textAlignVertical: "top",
              }}
            />
            <View style={styles.inputTools}>
              <Pressable
                testID="qa-paste-btn"
                onPress={pasteFromClipboard}
                style={[styles.smallBtn, { borderColor: colors.border }]}
              >
                <Ionicons
                  name="clipboard-outline"
                  size={13}
                  color={colors.onSurfaceSecondary}
                />
                <Text
                  style={[
                    styles.smallBtnText,
                    { color: colors.onSurfaceSecondary },
                  ]}
                >
                  Paste from clipboard
                </Text>
              </Pressable>
              {text.length > 0 ? (
                <Pressable
                  testID="qa-clear-btn"
                  onPress={clear}
                  style={[styles.smallBtn, { borderColor: colors.border }]}
                >
                  <Ionicons
                    name="close"
                    size={13}
                    color={colors.onSurfaceSecondary}
                  />
                  <Text
                    style={[
                      styles.smallBtnText,
                      { color: colors.onSurfaceSecondary },
                    ]}
                  >
                    Clear
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Error */}
          {error ? (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: colors.error + "22" },
              ]}
            >
              <Ionicons name="alert-circle" size={14} color={colors.error} />
              <Text style={{ color: colors.error, fontSize: 12, flex: 1 }}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* Preview */}
          {preview}

          {result ? (
            <Text style={[styles.reviewNote, { color: colors.muted }]}>
              Tap &quot;Continue&quot; to review &amp; save on the Add Order screen.
            </Text>
          ) : null}
        </ScrollView>

        {/* Sticky action bar */}
        <View
          style={[
            styles.actionBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          {!result ? (
            <Pressable
              testID="qa-extract-btn"
              onPress={extract}
              disabled={!canExtract}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: canExtract
                    ? colors.brandPrimary
                    : colors.surfaceTertiary,
                },
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="sparkles"
                    size={16}
                    color={
                      canExtract ? colors.onBrandPrimary : colors.muted
                    }
                  />
                  <Text
                    style={[
                      styles.primaryText,
                      {
                        color: canExtract
                          ? colors.onBrandPrimary
                          : colors.muted,
                      },
                    ]}
                  >
                    Extract with AI
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                testID="qa-redo-btn"
                onPress={() => {
                  setResult(null);
                  setError(null);
                }}
                style={[
                  styles.secondaryBtn,
                  { borderColor: colors.border },
                ]}
              >
                <Ionicons
                  name="refresh"
                  size={15}
                  color={colors.onSurface}
                />
                <Text
                  style={[styles.secondaryText, { color: colors.onSurface }]}
                >
                  Redo
                </Text>
              </Pressable>
              <Pressable
                testID="qa-continue-btn"
                onPress={useResult}
                style={[
                  styles.primaryBtn,
                  { flex: 1, backgroundColor: colors.brandPrimary },
                ]}
              >
                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color={colors.onBrandPrimary}
                />
                <Text
                  style={[
                    styles.primaryText,
                    { color: colors.onBrandPrimary },
                  ]}
                >
                  Continue
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <ToastModal
        visible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
        title={toast.title}
        tone={toast.tone}
      />
    </SafeAreaView>
  );
}

function KV({ label, value, full }: { label: string; value: string; full?: boolean }) {
  const { colors } = useOrders();
  return (
    <View style={[styles.kvItem, full && { flexBasis: "100%" }]}>
      <Text style={[styles.kvLabel, { color: colors.muted }]}>{label}</Text>
      <Text
        style={[styles.kvValue, { color: colors.onSurfaceSecondary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
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
  headerPad: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  h1: { fontSize: 26, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  hints: {
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    gap: 6,
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText: { fontSize: 12 },
  inputWrap: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  inputTools: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallBtnText: { fontSize: 12, fontWeight: "600" },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  previewCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewName: { fontSize: 15, fontWeight: "600" },
  previewMeta: { fontSize: 12, marginTop: 2 },
  previewPrice: { fontSize: 16, fontWeight: "700" },
  kvGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  kvItem: {
    flexBasis: "50%",
    paddingVertical: 6,
  },
  kvLabel: { fontSize: 11, fontWeight: "600" },
  kvValue: { fontSize: 13, marginTop: 2 },
  reviewNote: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 24,
  },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryText: { fontSize: 14, fontWeight: "600" },
});
