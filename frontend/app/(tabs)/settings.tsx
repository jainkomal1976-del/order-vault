import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useOrders } from "@/src/context/OrderContext";
import { useGmail } from "@/src/context/GmailContext";
import ToastModal from "@/src/components/ToastModal";
import { Order } from "@/src/constants";

function toCSV(orders: Order[]): string {
  const cols = [
    "id",
    "platform",
    "product_name",
    "category",
    "order_date",
    "price",
    "quantity",
    "order_id",
    "status",
    "expected_delivery",
    "actual_delivery",
    "payment_method",
    "return_deadline",
    "notes",
  ] as const;
  const esc = (v: any) => {
    if (v === undefined || v === null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = [cols.join(",")];
  for (const o of orders) {
    rows.push(cols.map((c) => esc((o as any)[c])).join(","));
  }
  return rows.join("\n");
}

export default function SettingsScreen() {
  const { colors, orders, themePref, setThemePref, mode, clearAll } = useOrders();
  const { gmail, connect, disconnect } = useGmail();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    msg?: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });
  const exportCSV = async () => {
    if (orders.length === 0) {
      setToast({
        visible: true,
        title: "Nothing to export",
        msg: "Add an order first.",
        tone: "info",
      });
      return;
    }
    const csv = toCSV(orders);
    try {
      await Share.share({
        message: csv,
        title: "OrderVault Export",
      });
    } catch (e: any) {
      setToast({
        visible: true,
        title: "Export failed",
        msg: e?.message,
        tone: "error",
      });
    }
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.headerPad}>
          <Text style={[styles.h1, { color: colors.onSurface }]}>Settings</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Preferences & data
          </Text>
        </View>

        <SectionHeader label="GMAIL SYNC" />
        {gmail ? (
          <>
            <Group>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      backgroundColor: colors.success + "22",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark" size={16} color={colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.onSurfaceSecondary, fontWeight: "700" }}>
                      Gmail connected
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                      {gmail.email}
                    </Text>
                  </View>
                </View>
                {gmail.last_sync_at ? (
                  <Text
                    style={{
                      color: colors.muted,
                      fontSize: 11,
                      marginTop: 8,
                      marginLeft: 42,
                    }}
                  >
                    Last sync: {new Date(gmail.last_sync_at).toLocaleString()}
                    {typeof gmail.last_sync_count === "number"
                      ? ` · ${gmail.last_sync_count} email${gmail.last_sync_count === 1 ? "" : "s"} found`
                      : ""}
                  </Text>
                ) : null}
              </View>
            </Group>
            <Group>
              <Row
                testID="gmail-sync-now-row"
                label="Sync now"
                icon="sync-outline"
                onPress={() => router.push("/gmail-review")}
                right={
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                }
              />
              <Divider />
              <Row
                testID="gmail-disconnect-row"
                label={confirmDisconnect ? "Tap again to disconnect" : "Disconnect Gmail"}
                icon="log-out-outline"
                danger
                right={
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                }
                onPress={async () => {
                  if (!confirmDisconnect) {
                    setConfirmDisconnect(true);
                    setTimeout(() => setConfirmDisconnect(false), 3500);
                    return;
                  }
                  await disconnect();
                  setConfirmDisconnect(false);
                  setToast({
                    visible: true,
                    title: "Gmail disconnected",
                    tone: "info",
                  });
                }}
              />
            </Group>
          </>
        ) : (
          <View
            style={[
              styles.gmailCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.gmailHeader}>
              <View
                style={[
                  styles.gmailIcon,
                  { backgroundColor: colors.brandPrimary },
                ]}
              >
                <Ionicons name="mail" size={18} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 15 }}
                >
                  Connect Gmail
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  Auto-import order confirmations from Amazon, Flipkart, Myntra, Ajio, Nykaa &amp; Meesho.
                </Text>
              </View>
            </View>
            <View style={styles.gmailPerks}>
              <PerkRow icon="checkmark-circle" tint={colors.success} text="Read-only access" />
              <PerkRow icon="checkmark-circle" tint={colors.success} text="Only order-confirmation senders" />
              <PerkRow icon="checkmark-circle" tint={colors.success} text="Nothing stored on our servers" />
              <PerkRow icon="checkmark-circle" tint={colors.success} text="You can disconnect anytime" />
            </View>
            <Text style={[styles.gmailNote, { color: colors.muted }]}>
              Google will show a &ldquo;not verified&rdquo; warning — this is normal for personal apps. Tap Advanced → Continue.
            </Text>
            <Pressable
              testID="gmail-connect-btn"
              disabled={connecting}
              onPress={async () => {
                setConnecting(true);
                const r = await connect();
                setConnecting(false);
                if (r.ok) {
                  setToast({
                    visible: true,
                    title: "Gmail connected",
                    msg: "Tap Sync now to import your orders.",
                    tone: "success",
                  });
                } else {
                  setToast({
                    visible: true,
                    title: "Sign-in cancelled",
                    msg: r.error,
                    tone: "info",
                  });
                }
              }}
              style={[
                styles.gmailBtn,
                { backgroundColor: colors.brandPrimary },
              ]}
            >
              <Ionicons
                name={connecting ? "hourglass" : "logo-google"}
                size={16}
                color={colors.onBrandPrimary}
              />
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "700" }}>
                {connecting ? "Opening Google…" : "Continue with Google"}
              </Text>
            </Pressable>
          </View>
        )}

        <SectionHeader label="APPEARANCE" />
        <Group>
          <Row
            testID="theme-system-row"
            label="System"
            right={
              <Radio selected={themePref === "system"} />
            }
            onPress={() => setThemePref("system")}
          />
          <Divider />
          <Row
            testID="theme-light-row"
            label="Light"
            right={<Radio selected={themePref === "light"} />}
            onPress={() => setThemePref("light")}
          />
          <Divider />
          <Row
            testID="theme-dark-row"
            label="Dark"
            right={<Radio selected={themePref === "dark"} />}
            onPress={() => setThemePref("dark")}
          />
        </Group>

        <SectionHeader label="DATA" />
        <Group>
          <Row
            testID="export-csv-row"
            label="Export to CSV"
            icon="download-outline"
            right={
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            }
            onPress={exportCSV}
          />
          <Divider />
          <Row
            testID="clear-all-row"
            label={confirmClear ? "Tap again to confirm" : "Clear all orders"}
            icon="trash-outline"
            danger
            right={
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.muted}
              />
            }
            onPress={async () => {
              if (!confirmClear) {
                setConfirmClear(true);
                setTimeout(() => setConfirmClear(false), 3500);
                return;
              }
              await clearAll();
              setConfirmClear(false);
              setToast({
                visible: true,
                title: "All orders cleared",
                tone: "info",
              });
            }}
          />
        </Group>

        <SectionHeader label="ABOUT" />
        <Group>
          <Row label="App" right={<Muted text="OrderVault" />} />
          <Divider />
          <Row label="Version" right={<Muted text="1.0.0" />} />
          <Divider />
          <Row label="Storage" right={<Muted text="On-device only" />} />
        </Group>

        <Text
          style={[styles.footNote, { color: colors.muted }]}
        >
          Your orders are stored locally on this device.
        </Text>
      </ScrollView>

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

function SectionHeader({ label }: { label: string }) {
  const { colors } = useOrders();
  return (
    <Text
      style={[
        styles.sectionHeader,
        { color: colors.muted, marginTop: 20, paddingHorizontal: 16 },
      ]}
    >
      {label}
    </Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const { colors } = useOrders();
  return (
    <View
      style={[
        styles.group,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

function Row({
  label,
  right,
  onPress,
  icon,
  testID,
  danger,
}: {
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
  icon?: any;
  testID?: string;
  danger?: boolean;
}) {
  const { colors } = useOrders();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={danger ? colors.error : colors.onSurfaceSecondary}
          style={{ marginRight: 10 }}
        />
      ) : null}
      <Text
        style={{
          fontSize: 15,
          color: danger ? colors.error : colors.onSurfaceSecondary,
          flex: 1,
        }}
      >
        {label}
      </Text>
      {right}
    </Pressable>
  );
}

function Divider() {
  const { colors } = useOrders();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.divider,
        marginLeft: 16,
      }}
    />
  );
}

function Radio({ selected }: { selected: boolean }) {
  const { colors } = useOrders();
  return (
    <View
      style={[
        styles.radioOuter,
        { borderColor: selected ? colors.brandPrimary : colors.border },
      ]}
    >
      {selected ? (
        <View
          style={[styles.radioInner, { backgroundColor: colors.brandPrimary }]}
        />
      ) : null}
    </View>
  );
}

function Muted({ text }: { text: string }) {
  const { colors } = useOrders();
  return (
    <Text style={{ color: colors.muted, fontSize: 13 }}>{text}</Text>
  );
}

function PerkRow({
  icon,
  tint,
  text,
}: {
  icon: any;
  tint: string;
  text: string;
}) {
  const { colors } = useOrders();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
      <Ionicons name={icon} size={14} color={tint} />
      <Text style={{ color: colors.onSurfaceSecondary, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerPad: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  h1: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  group: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  gmailCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  gmailHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  gmailIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  gmailPerks: { marginTop: 12, paddingLeft: 4 },
  gmailNote: { fontSize: 11, marginTop: 12, lineHeight: 15 },
  gmailBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footNote: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
