import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useGmail } from "@/src/context/GmailContext";
import { useOrders } from "@/src/context/OrderContext";
import {
  PLATFORMS,
  PLATFORM_COLORS,
  PlatformName,
  Category,
  OrderStatus,
  ORDER_STATUSES,
  STATUS_TIMELINE,
  Order,
} from "@/src/constants";
import PlatformAvatar from "@/src/components/PlatformAvatar";
import StatusBadge from "@/src/components/StatusBadge";
import ToastModal from "@/src/components/ToastModal";
import { formatDate, formatINR } from "@/src/utils/orderHelpers";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
// For testing, increase sync window to the maximum (6 months = 180 days)
const SYNC_WINDOW_DAYS = 180;

interface ParsedItem {
  message_id: string;
  email_subject?: string;
  email_from?: string;
  email_date?: string;
  product_name?: string;
  price?: number;
  platform?: string;
  order_date?: string;
  expected_delivery?: string;
  actual_delivery?: string;
  quantity?: number;
  order_id?: string;
  status?: string;
  parse_error?: string;
}

interface GroupedItem {
  key: string; // order_id or fallback message_id
  primary: ParsedItem; // "best" item — latest status stage
  emails: ParsedItem[]; // all emails belonging to this group
  saved?: boolean;
  skipped?: boolean;
}

// Terminal statuses take precedence over the forward timeline.
const TERMINAL: OrderStatus[] = ["Cancelled", "Returned", "Exchanged"];

function statusRank(s?: string): number {
  if (!s) return 0;
  const t = TERMINAL.indexOf(s as OrderStatus);
  if (t >= 0) return 100 + t; // terminal always > any timeline stage
  const p = STATUS_TIMELINE.indexOf(s as OrderStatus);
  return p >= 0 ? p : 0;
}

function isValidStatus(s?: string): s is OrderStatus {
  if (!s) return false;
  return (ORDER_STATUSES as string[]).includes(s);
}

// Normalize an order id for grouping: strip whitespace, dashes, dots and lowercase.
// e.g. "OD-123.456", "od 123456", "OD123456" all become "od123456".
function normOrderId(id?: string): string {
  if (!id) return "";
  return id.replace(/[\s\-\._#/]+/g, "").toLowerCase();
}

// Normalize a product name for grouping fallback when no order_id is available.
// Take the first 5 alphanumeric tokens, lowercased.
function normProduct(name?: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
}

function groupKey(it: ParsedItem): string {
  const oid = normOrderId(it.order_id);
  if (oid) return `oid:${oid}`;
  const platform = (it.platform || "other").toLowerCase();
  const p = normProduct(it.product_name);
  if (p) return `pp:${platform}:${p}`;
  return `msg:${it.message_id}`;
}

function groupItems(items: ParsedItem[]): GroupedItem[] {
  const groups = new Map<string, GroupedItem>();
  for (const it of items) {
    const key = groupKey(it);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, primary: it, emails: [it] });
      continue;
    }
    g.emails.push(it);
    // Promote to primary using a combination of status rank (progression) and
    // recency (email_date). This ensures that when two emails for the same
    // order conflict (e.g. "Out for Delivery" vs a later "Ordered for RG" or
    // replacement), we consider the most recent message unless the current
    // primary is a terminal status which should not be downgraded.
    const candRank = statusRank(it.status);
    const primRank = statusRank(g.primary.status);
    const parseDateMs = (s?: string): number => {
      if (!s) return 0;
      const t = Date.parse(s);
      return Number.isNaN(t) ? 0 : t;
    };
    const candTime = parseDateMs(it.email_date || it.order_date);
    const primTime = parseDateMs(g.primary.email_date || g.primary.order_date);

    let shouldPromote = false;
    if (candRank > primRank) {
      shouldPromote = true;
    } else if (candRank === primRank) {
      // If same status progression, prefer the more recent email
      if (candTime > primTime) shouldPromote = true;
    } else {
      // candRank < primRank: only promote if primary is not a terminal status
      // (Cancelled/Returned/Exchanged are considered terminal) and the candidate
      // email is more recent — this avoids downgrading confirmed terminal states.
      if (primRank < 100 && candTime > primTime) shouldPromote = true;
    }

    if (shouldPromote) {
      g.primary = {
        ...g.primary,
        ...it,
        // don't overwrite these if the new one lacks them
        product_name: it.product_name || g.primary.product_name,
        price: typeof it.price === "number" ? it.price : g.primary.price,
        order_date: it.order_date || g.primary.order_date,
        expected_delivery: it.expected_delivery || g.primary.expected_delivery,
        actual_delivery: it.actual_delivery || g.primary.actual_delivery,
        order_id: it.order_id || g.primary.order_id,
      };
    } else {
      // Backfill missing fields on the primary from any other email in the group
      if (!g.primary.product_name && it.product_name) g.primary.product_name = it.product_name;
      if (typeof g.primary.price !== "number" && typeof it.price === "number") g.primary.price = it.price;
      if (!g.primary.order_id && it.order_id) g.primary.order_id = it.order_id;
      if (!g.primary.order_date && it.order_date) g.primary.order_date = it.order_date;
      if (!g.primary.expected_delivery && it.expected_delivery) g.primary.expected_delivery = it.expected_delivery;
      if (!g.primary.actual_delivery && it.actual_delivery) g.primary.actual_delivery = it.actual_delivery;
    }
  }
  // Final pass: ensure primary is the best representative for each group by
  // selecting the email with the highest status rank and then newest date.
  const out: GroupedItem[] = [];
  for (const [k, g] of groups.entries()) {
    const best = g.emails.reduce((bestSoFar, cand) => {
      const bestRank = statusRank(bestSoFar.status);
      const candRank = statusRank(cand.status);
      if (candRank > bestRank) return cand;
      if (candRank < bestRank) return bestSoFar;
      // ranks equal: prefer more recent email_date/order_date
      const parseDateMs = (s?: string): number => {
        if (!s) return 0;
        const t = Date.parse(s);
        return Number.isNaN(t) ? 0 : t;
      };
      const candTime = parseDateMs(cand.email_date || cand.order_date);
      const bestTime = parseDateMs(bestSoFar.email_date || bestSoFar.order_date);
      return candTime >= bestTime ? cand : bestSoFar;
    }, g.primary);

    // Build a merged primary that backfills missing fields from the chosen best
    const mergedPrimary = {
      ...g.primary,
      ...best,
      product_name: best.product_name || g.primary.product_name,
      price: typeof best.price === "number" ? best.price : g.primary.price,
      order_date: best.order_date || g.primary.order_date,
      expected_delivery: best.expected_delivery || g.primary.expected_delivery,
      actual_delivery: best.actual_delivery || g.primary.actual_delivery,
      order_id: best.order_id || g.primary.order_id,
    };
    out.push({ key: k, primary: mergedPrimary, emails: g.emails });
  }
  // Merge groups that likely refer to the same order: if one group has an
  // explicit order_id (oid) and another group is a product-based key (pp)
  // with the same normalized product+platform, merge them so the final
  // representative shows the latest/highest-status state.
  const oidMap = new Map<string, GroupedItem>();
  const ppList: GroupedItem[] = [];
  for (const g of out) {
    const oid = normOrderId(g.primary.order_id);
    if (oid) oidMap.set(oid, g);
    else ppList.push(g);
  }

  for (const g of ppList) {
    // Extract platform and normalized product from group's primary
    const platform = (g.primary.platform || "other").toLowerCase();
    const pnorm = normProduct(g.primary.product_name);
    // Try to find a matching oid group by comparing normalized product and platform
    let merged = false;
    for (const [oid, target] of oidMap.entries()) {
      const tplatform = (target.primary.platform || "other").toLowerCase();
      const tnorm = normProduct(target.primary.product_name);
      if (platform === tplatform && pnorm && tnorm && pnorm === tnorm) {
        // merge g into target
        target.emails = target.emails.concat(g.emails);
        // recompute primary for the merged group (pick best by rank/date)
        const best = target.emails.reduce((bestSoFar, cand) => {
          const bestRank = statusRank(bestSoFar.status);
          const candRank = statusRank(cand.status);
          if (candRank > bestRank) return cand;
          if (candRank < bestRank) return bestSoFar;
          const parseDateMs = (s?: string): number => {
            if (!s) return 0;
            const t = Date.parse(s);
            return Number.isNaN(t) ? 0 : t;
          };
          const candTime = parseDateMs(cand.email_date || cand.order_date);
          const bestTime = parseDateMs(bestSoFar.email_date || bestSoFar.order_date);
          return candTime >= bestTime ? cand : bestSoFar;
        }, target.primary);
        target.primary = {
          ...target.primary,
          ...best,
          product_name: best.product_name || target.primary.product_name,
          price: typeof best.price === "number" ? best.price : target.primary.price,
          order_date: best.order_date || target.primary.order_date,
          expected_delivery: best.expected_delivery || target.primary.expected_delivery,
          actual_delivery: best.actual_delivery || target.primary.actual_delivery,
          order_id: best.order_id || target.primary.order_id,
        };
        merged = true;
        break;
      }
    }
    if (!merged) {
      // keep as-is
      oidMap.set(g.key, g);
    }
  }

  return Array.from(oidMap.values());
}

export default function GmailReviewScreen() {
  const { colors, orders, addOrder, updateOrder } = useOrders();
  const { gmail, getFreshAccessToken, setLastSync } = useGmail();
  const router = useRouter();

  const [groups, setGroups] = useState<GroupedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    title: string;
    tone?: "success" | "error" | "info";
  }>({ visible: false, title: "" });

  useEffect(() => {
    (async () => {
      if (!gmail) {
        setError("Gmail is not connected.");
        setLoading(false);
        return;
      }
      const token = await getFreshAccessToken();
      if (!token) {
        setError("Access token expired. Please reconnect Gmail.");
        setLoading(false);
        return;
      }
      try {
        const r = await fetch(`${BACKEND}/api/gmail/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: token,
            since_days: SYNC_WINDOW_DAYS,
            max_messages: 25,
          }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(`Sync failed (${r.status}) ${txt}`);
        }
        const data = await r.json();
        const items: ParsedItem[] = data.items || [];
        setGroups(groupItems(items));
        await setLastSync(items.length);
        // Auto-import all ready items after sync so the vault receives the
        // latest order states automatically during testing.
        // We schedule importAll() after a short delay so the UI can render
        // the groups first; importAll is defined later in this component.
        setTimeout(() => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          importAll();
        }, 50);
      } catch (e: any) {
        setError(e?.message || "Sync failed");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Find existing order by normalized order_id (or by [gmail:message_id] tag in notes)
  const findExistingOrder = (g: GroupedItem): Order | undefined => {
    const targetOid = normOrderId(g.primary.order_id);
    if (targetOid) {
      const byOid = orders.find((o) => normOrderId(o.order_id) === targetOid);
      if (byOid) return byOid;
    }
    for (const em of g.emails) {
      const tag = `[gmail:${em.message_id}]`;
      const byMid = orders.find((o) => o.notes?.includes(tag));
      if (byMid) return byMid;
    }
    return undefined;
  };

  const importable = groups.filter(
    (g) =>
      !g.saved &&
      !g.skipped &&
      !g.primary.parse_error &&
      g.primary.product_name &&
      typeof g.primary.price === "number",
  );

  const saveGroup = async (g: GroupedItem) => {
    setSavingKey(g.key);
    try {
      const it = g.primary;
      const platform: PlatformName =
        (it.platform && (PLATFORMS as string[]).includes(it.platform)
          ? (it.platform as PlatformName)
          : "Other") as PlatformName;
      const status: OrderStatus = isValidStatus(it.status) ? it.status : "Ordered";
      const existing = findExistingOrder(g);

      if (existing) {
        // Decide whether to update status on an existing order.
        // Prefer status progression (statusRank) but also allow updating to a
        // newer message's status when the incoming email is more recent than
        // the dates known on the existing order — except when the existing
        // order is in a terminal state (Cancelled/Returned/Exchanged).
        const patch: Partial<Order> = {};
        const incomingRank = statusRank(status);
        const existingRank = statusRank(existing.status);
        const parseDateMs = (s?: string): number => {
          if (!s) return 0;
          const t = Date.parse(s);
          return Number.isNaN(t) ? 0 : t;
        };
        const incomingTime = parseDateMs(g.primary.email_date || g.primary.order_date);
        const existingTime =
          parseDateMs(existing.actual_delivery) ||
          parseDateMs(existing.expected_delivery) ||
          parseDateMs(existing.order_date) ||
          0;

        if (
          incomingRank > existingRank ||
          (incomingTime > existingTime && existingRank < 100)
        ) {
          patch.status = status;
        }
        // Fill in delivery dates if the existing order is missing them
        if (!existing.expected_delivery && it.expected_delivery) {
          patch.expected_delivery = it.expected_delivery;
        }
        if (!existing.actual_delivery && it.actual_delivery) {
          patch.actual_delivery = it.actual_delivery;
        }
        if (Object.keys(patch).length > 0) {
          await updateOrder(existing.id, patch);
          setToast({
            visible: true,
            title: patch.status
              ? `Updated to ${patch.status}`
              : "Delivery dates updated",
            tone: "success",
          });
        } else {
          setToast({
            visible: true,
            title: "Already in vault",
            tone: "info",
          });
        }
      } else {
        // Compose a notes field that keeps ALL message_ids from this group so
        // re-imports can dedup across every source email.
        const notes =
          "Imported from Gmail " +
          g.emails.map((e) => `[gmail:${e.message_id}]`).join(" ");
        await addOrder({
          platform,
          product_name: it.product_name || "(Untitled)",
          category: "Other" as Category,
          order_date: it.order_date || new Date().toISOString().slice(0, 10),
          price: typeof it.price === "number" ? it.price : 0,
          quantity: it.quantity || 1,
          order_id: it.order_id,
          status,
          expected_delivery: it.expected_delivery,
          actual_delivery: it.actual_delivery,
          notes,
        });
        setToast({
          visible: true,
          title: `Added as ${status}`,
          tone: "success",
        });
      }
      setGroups((prev) =>
        prev.map((p) => (p.key === g.key ? { ...p, saved: true } : p)),
      );
    } catch {
      setToast({
        visible: true,
        title: "Save failed",
        tone: "error",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const skipGroup = (g: GroupedItem) => {
    setGroups((prev) =>
      prev.map((p) => (p.key === g.key ? { ...p, skipped: true } : p)),
    );
  };

  const importAll = async () => {
    for (const g of importable) {
      // eslint-disable-next-line no-await-in-loop
      await saveGroup(g);
    }
    setToast({
      visible: true,
      title: "Import complete",
      tone: "success",
    });
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safe, { backgroundColor: colors.surface }]}
    >
      <View style={styles.headerBar}>
        <Pressable
          testID="gr-back-btn"
          onPress={() => router.back()}
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]}>
          Gmail Sync
        </Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={[styles.centerText, { color: colors.muted }]}>
            Scanning your inbox…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={44} color={colors.error} />
          <Text style={[styles.centerText, { color: colors.error }]}>
            {error}
          </Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="mail-open-outline" size={44} color={colors.muted} />
          <Text style={[styles.centerText, { color: colors.onSurface }]}>
            No new orders in the last {SYNC_WINDOW_DAYS} days
          </Text>
          <Text style={[styles.subtle, { color: colors.muted }]}>
            We looked for confirmations from Amazon, Flipkart, Myntra, Ajio,
            Nykaa and Meesho.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryText, { color: colors.muted }]}>
              {groups.length} order{groups.length === 1 ? "" : "s"} found · {importable.length} ready
            </Text>
            {importable.length > 0 ? (
              <Pressable
                testID="gr-import-all-btn"
                onPress={importAll}
                style={[
                  styles.importAll,
                  { backgroundColor: colors.brandPrimary },
                ]}
              >
                <Ionicons
                  name="download"
                  size={13}
                  color={colors.onBrandPrimary}
                />
                <Text
                  style={{
                    color: colors.onBrandPrimary,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  Import all
                </Text>
              </Pressable>
            ) : null}
          </View>

          <FlatList
            testID="gr-list"
            data={groups}
            keyExtractor={(g) => g.key}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item: g }) => {
              const it = g.primary;
              const existing = findExistingOrder(g);
              const dup = !!existing;
              const platform =
                it.platform && (PLATFORMS as string[]).includes(it.platform)
                  ? (it.platform as PlatformName)
                  : "Other";
              const accent = PLATFORM_COLORS[platform];
              const status: OrderStatus = isValidStatus(it.status)
                ? it.status
                : "Ordered";
              const wouldAdvance =
                dup && existing && statusRank(status) > statusRank(existing.status);
              return (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surfaceSecondary,
                      borderColor: colors.border,
                      opacity: g.skipped ? 0.5 : 1,
                    },
                  ]}
                >
                  <View style={[styles.accent, { backgroundColor: accent }]} />
                  <View style={styles.body}>
                    <View style={styles.rowTop}>
                      <PlatformAvatar platform={platform} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.name,
                            { color: colors.onSurfaceSecondary },
                          ]}
                        >
                          {it.product_name ||
                            it.email_subject ||
                            "(Unable to extract)"}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.meta,
                            { color: accent, fontWeight: "600" },
                          ]}
                        >
                          {platform}
                          {it.order_date ? "  ·  " + formatDate(it.order_date) : ""}
                        </Text>
                      </View>
                      {typeof it.price === "number" ? (
                        <Text
                          style={[
                            styles.price,
                            { color: colors.onSurfaceSecondary },
                          ]}
                        >
                          {formatINR(it.price * (it.quantity || 1))}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.badgeRow}>
                      <StatusBadge status={status} />
                      {g.emails.length > 1 ? (
                        <View
                          style={[
                            styles.multiTag,
                            { backgroundColor: colors.surfaceTertiary },
                          ]}
                        >
                          <Ionicons
                            name="layers-outline"
                            size={11}
                            color={colors.onSurfaceTertiary}
                          />
                          <Text
                            style={{
                              color: colors.onSurfaceTertiary,
                              fontSize: 10,
                              fontWeight: "600",
                            }}
                          >
                            {g.emails.length} emails
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {it.parse_error ? (
                      <Text style={{ color: colors.error, fontSize: 12, marginTop: 6 }}>
                        Couldn&apos;t parse: {it.parse_error}
                      </Text>
                    ) : !it.product_name ? (
                      <Text style={{ color: colors.error, fontSize: 12, marginTop: 6 }}>
                        ⚠️ Product name missing
                      </Text>
                    ) : typeof it.price !== "number" ? (
                      <Text style={{ color: colors.error, fontSize: 12, marginTop: 6 }}>
                        ⚠️ Price missing (found: {it.price})
                      </Text>
                    ) : null}

                    <View style={styles.actions}>
                      {g.saved ? (
                        <View style={styles.savedTag}>
                          <Ionicons
                            name="checkmark-circle"
                            size={14}
                            color={colors.success}
                          />
                          <Text
                            style={{
                              color: colors.success,
                              fontSize: 12,
                              fontWeight: "600",
                            }}
                          >
                            {dup ? "Updated" : "Added"}
                          </Text>
                        </View>
                      ) : g.skipped ? (
                        <Text
                          style={{
                            color: colors.muted,
                            fontSize: 12,
                            fontWeight: "600",
                          }}
                        >
                          Skipped
                        </Text>
                      ) : dup && !wouldAdvance ? (
                        <View style={styles.savedTag}>
                          <Ionicons name="link" size={14} color={colors.info} />
                          <Text
                            style={{
                              color: colors.info,
                              fontSize: 12,
                              fontWeight: "600",
                            }}
                          >
                            Already in vault
                          </Text>
                        </View>
                      ) : (
                        <>
                          <Pressable
                            testID={`gr-skip-${g.key}`}
                            onPress={() => skipGroup(g)}
                            style={[
                              styles.actionBtn,
                              { borderColor: colors.border },
                            ]}
                          >
                            <Ionicons
                              name="close"
                              size={13}
                              color={colors.onSurfaceSecondary}
                            />
                            <Text
                              style={{
                                color: colors.onSurfaceSecondary,
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              Skip
                            </Text>
                          </Pressable>
                          <Pressable
                            testID={`gr-add-${g.key}`}
                            onPress={() => saveGroup(g)}
                            disabled={
                              savingKey === g.key ||
                              !!it.parse_error ||
                              !it.product_name ||
                              typeof it.price !== "number"
                            }
                            style={[
                              styles.actionBtn,
                              styles.actionBtnPrimary,
                              {
                                backgroundColor:
                                  !!it.parse_error ||
                                  !it.product_name ||
                                  typeof it.price !== "number"
                                    ? colors.surfaceTertiary
                                    : colors.brandPrimary,
                              },
                            ]}
                          >
                            {savingKey === g.key ? (
                              <ActivityIndicator
                                size="small"
                                color={colors.onBrandPrimary}
                              />
                            ) : (
                              <>
                                <Ionicons
                                  name={wouldAdvance ? "refresh" : "add"}
                                  size={13}
                                  color={
                                    !!it.parse_error ||
                                    !it.product_name ||
                                    typeof it.price !== "number"
                                      ? colors.muted
                                      : colors.onBrandPrimary
                                  }
                                />
                                <Text
                                  style={{
                                    color:
                                      !!it.parse_error ||
                                      !it.product_name ||
                                      typeof it.price !== "number"
                                        ? colors.muted
                                        : colors.onBrandPrimary,
                                    fontSize: 12,
                                    fontWeight: "700",
                                  }}
                                >
                                  {wouldAdvance ? "Update" : "Add"}
                                </Text>
                              </>
                            )}
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}

      <ToastModal
        visible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
        title={toast.title}
        tone={toast.tone}
      />
    </SafeAreaView>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  centerText: { fontSize: 15, textAlign: "center" },
  subtle: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 4,
  },
  summaryText: { fontSize: 12, fontWeight: "600" },
  importAll: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  card: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 10,
  },
  accent: { width: 4 },
  body: { flex: 1, padding: 12 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 11, marginTop: 2 },
  price: { fontSize: 14, fontWeight: "700" },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  multiTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  actions: {
    flexDirection: "row",
    marginTop: 10,
    gap: 8,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  actionBtn: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionBtnPrimary: { borderWidth: 0 },
  savedTag: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
});
