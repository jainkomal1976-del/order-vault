import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useOrders } from "@/src/context/OrderContext";
import { useGmail } from "@/src/context/GmailContext";
import { useRouter, useLocalSearchParams } from "expo-router";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

// This route is reached when redirected back from Google OAuth callback
export default function GmailConnected() {
  const { colors } = useOrders();
  const { setLastSync } = useGmail();
  const router = useRouter();
  const params = useLocalSearchParams();
  const sessionId = typeof params.session === "string" ? params.session : params.session?.[0];
  const [status, setStatus] = useState("Processing sign-in…");
  const [error, setError] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false); // ✅ Prevent multiple consume calls

  useEffect(() => {
    // ✅ Only run once, and only if we have a sessionId and haven't consumed yet
    if (!sessionId || !BACKEND || consumed) {
      if (!sessionId) {
        setError("Missing session ID");
      } else if (!BACKEND) {
        setError("Missing backend URL");
      }
      return;
    }

    (async () => {
      try {
        console.log("📝 Consuming session:", sessionId);

        // Exchange session ID for Gmail tokens
        const r = await fetch(`${BACKEND}/api/gmail/session/consume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });

        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          console.error("Session consume failed:", detail);
          setError(`Sign-in failed: ${r.status}`);
          return;
        }

        const data = await r.json();
        console.log("✅ Session consumed, Gmail connected:", data.email);

        // Store Gmail state in secure storage
        const gmailState = {
          email: data.email || "Unknown",
          access_token: data.access_token,
          refresh_token: data.refresh_token || "",
          expires_at: data.expires_at || Math.floor(Date.now() / 1000) + 3300,
          connected_at: Date.now(),
        };

        if (Platform.OS !== "web") {
          await SecureStore.setItemAsync("ordervault.gmail.v1", JSON.stringify(gmailState));
        } else {
          // On web, use localStorage
          globalThis.localStorage?.setItem("ordervault.gmail.v1", JSON.stringify(gmailState));
        }
        console.log("✅ Gmail state saved to storage");

        setConsumed(true); // ✅ Mark as consumed to prevent future calls
        setStatus("Gmail connected!");

        // Mark last sync
        await setLastSync(0);

        // Do a hard reload so GmailProvider reads the updated storage
        if (Platform.OS === "web") {
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else {
          // On native, navigate back
          setTimeout(() => {
            router.replace("/(tabs)");
          }, 1000);
        }
      } catch (e: any) {
        console.error("Error consuming session:", e);
        setError(e?.message || "Unknown error");
      }
    })();
  }, [sessionId, BACKEND, setLastSync, router, consumed]); // ✅ Added 'consumed' to deps

  return (
    <View style={[styles.center, { backgroundColor: colors.surface }]}>
      <ActivityIndicator color={colors.brandPrimary} size="large" />
      <Text style={{ color: colors.onSurface, marginTop: 12, fontWeight: "600" }}>
        {error ? "Sign-in failed" : status}
      </Text>
      <Text style={{ color: error ? colors.error : colors.muted, marginTop: 4, fontSize: 12 }}>
        {error
          ? error
          : Platform.OS === "web"
          ? "You can close this tab and return to OrderVault."
          : "Returning to app…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
