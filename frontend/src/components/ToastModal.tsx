import React from "react";
import { View, Text, StyleSheet, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useOrders } from "@/src/context/OrderContext";

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  tone?: "success" | "error" | "info";
}

// Simple toast-like modal (auto-dismissable) — replaces Alert.
export default function ToastModal({
  visible,
  onClose,
  title,
  message,
  tone = "success",
}: Props) {
  const { colors } = useOrders();
  const icon =
    tone === "success"
      ? "checkmark-circle"
      : tone === "error"
      ? "alert-circle"
      : "information-circle";
  const color =
    tone === "success"
      ? colors.success
      : tone === "error"
      ? colors.error
      : colors.info;

  React.useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [visible, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} pointerEvents="box-none">
        <Pressable
          testID="toast-modal"
          onPress={onClose}
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceSecondary,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons name={icon} size={22} color={color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.onSurfaceSecondary }]}>
              {title}
            </Text>
            {message ? (
              <Text style={[styles.msg, { color: colors.muted }]}>{message}</Text>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 80,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 260,
    maxWidth: "90%",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { fontWeight: "600", fontSize: 14 },
  msg: { fontSize: 12, marginTop: 2 },
});
