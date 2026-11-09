import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

const KEY = "ordervault.gmail.v1";
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface GmailState {
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  connected_at: number; // epoch ms
  last_sync_at?: number; // epoch ms
  last_sync_count?: number;
}

interface GmailContextValue {
  gmail: GmailState | null;
  loading: boolean;
  connect: () => Promise<{ ok: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  getFreshAccessToken: () => Promise<string | null>;
  setLastSync: (count: number) => Promise<void>;
}

const GmailContext = createContext<GmailContextValue | null>(null);

// Cross-platform key/value using SecureStore on native, localStorage on web
async function kvGet(k: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(k);
  } catch {
    return null;
  }
}
async function kvSet(k: string, v: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(k, v);
}
async function kvDel(k: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(k);
}

function parseUrlQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const q = url.split("?")[1];
    if (!q) return out;
    const cleaned = q.split("#")[0];
    for (const part of cleaned.split("&")) {
      const [k, v = ""] = part.split("=");
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  } catch {}
  return out;
}

export function GmailProvider({ children }: { children: React.ReactNode }) {
  const [gmail, setGmail] = useState<GmailState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await kvGet(KEY);
        if (raw) setGmail(JSON.parse(raw));
      } catch {}
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (s: GmailState | null) => {
    if (s) await kvSet(KEY, JSON.stringify(s));
    else await kvDel(KEY);
    setGmail(s);
  }, []);

  const connect = useCallback(async () => {
    if (!BACKEND) return { ok: false, error: "Backend URL missing" };
    try {
      console.log("🔐 Gmail OAuth Flow Started");
      console.log("  Platform:", Platform.OS);
      console.log("  Backend:", BACKEND);

      if (Platform.OS === "web") {
        // On web, use a direct window redirect
        const returnUrl = `${typeof window !== "undefined" 
          ? `${window.location.protocol}//${window.location.host}`
          : BACKEND}/gmail-connected`;
        const startUrl = `${BACKEND}/api/gmail/start?return_url=${encodeURIComponent(returnUrl)}`;
        console.log("  Web mode - redirecting to:", startUrl);
        window.location.href = startUrl;
        return { ok: true }; // This won't actually return since we're redirecting
      }

      // Native app flow
      const returnUrl = Linking.createURL("gmail-connected");
      console.log("  Native mode - Return URL:", returnUrl);
      const startUrl = `${BACKEND}/api/gmail/start?return_url=${encodeURIComponent(returnUrl)}`;
      console.log("  Start URL:", startUrl);

      console.log("  Opening WebBrowser...");
      const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl, {
        preferEphemeralSession: true,
      });
      console.log("  WebBrowser result:", {
        type: result.type,
        url: result.url?.substring(0, 100) + (result.url && result.url.length > 100 ? "..." : ""),
      });

      if (result.type !== "success") {
        console.error("  OAuth cancelled or failed:", result.type);
        return { ok: false, error: `Sign-in cancelled (${result.type})` };
      }

      if (!result.url) {
        console.error("  No redirect URL returned");
        return { ok: false, error: "No redirect URL returned" };
      }

      const params = parseUrlQuery(result.url);
      console.log("  Redirect params:", Object.keys(params));

      if (params.error) {
        console.error("  Google error:", params.error);
        return { ok: false, error: params.error };
      }

      const sessionId = params.session;
      if (!sessionId) {
        console.error("  No session ID in redirect");
        return { ok: false, error: "Missing session" };
      }

      console.log("  Session ID:", sessionId);

       const r = await fetch(`${BACKEND}/api/gmail/session/consume`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ session_id: sessionId }),
       });
       if (!r.ok) {
         const detail = await r.text().catch(() => "");
         console.error("  Session consume failed:", r.status, detail);
         return { ok: false, error: `Consume failed: ${r.status} ${detail}` };
       }
       const data = await r.json();
       if (!data.access_token) {
         console.error("  No access token in response");
         return { ok: false, error: "No access token returned" };
       }
       console.log("  ✅ Successfully received access token");
       const state: GmailState = {
         email: data.email || "Unknown",
         access_token: data.access_token,
         refresh_token: data.refresh_token || "",
         expires_at: data.expires_at || Math.floor(Date.now() / 1000) + 3300,
         connected_at: Date.now(),
       };
       await persist(state);
       console.log("  ✅ Gmail connected:", data.email);
       return { ok: true };
     } catch (e: any) {
       console.error("  ❌ OAuth Error:", e);
       return { ok: false, error: e?.message || "Unknown error" };
     }
  }, [persist]);

  const disconnect = useCallback(async () => {
    const g = gmail;
    await persist(null);
    if (BACKEND && g?.refresh_token) {
      try {
        await fetch(`${BACKEND}/api/gmail/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: g.refresh_token }),
        });
      } catch {}
    }
  }, [gmail, persist]);

   const getFreshAccessToken = useCallback(async () => {
     if (!gmail) return null;
     const now = Math.floor(Date.now() / 1000);
     if (gmail.access_token && gmail.expires_at > now + 30) {
       return gmail.access_token;
     }
     if (!gmail.refresh_token || !BACKEND) return null;
     try {
       const r = await fetch(`${BACKEND}/api/gmail/refresh`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ refresh_token: gmail.refresh_token }),
       });
       if (!r.ok) {
         const errText = await r.text().catch(() => "Unknown error");
         console.error(`Token refresh failed (${r.status}):`, errText);
         return null;
       }
       const data = await r.json();
       const next: GmailState = {
         ...gmail,
         access_token: data.access_token,
         expires_at: data.expires_at,
       };
       await persist(next);
       return next.access_token;
     } catch (e) {
       console.error("Token refresh error:", e);
       return null;
     }
   }, [gmail, persist]);

  const setLastSync = useCallback(
    async (count: number) => {
      if (!gmail) return;
      const next: GmailState = {
        ...gmail,
        last_sync_at: Date.now(),
        last_sync_count: count,
      };
      await persist(next);
    },
    [gmail, persist],
  );

  const value = useMemo<GmailContextValue>(
    () => ({ gmail, loading, connect, disconnect, getFreshAccessToken, setLastSync }),
    [gmail, loading, connect, disconnect, getFreshAccessToken, setLastSync],
  );

  return <GmailContext.Provider value={value}>{children}</GmailContext.Provider>;
}

export function useGmail() {
  const ctx = useContext(GmailContext);
  if (!ctx) throw new Error("useGmail must be used within GmailProvider");
  return ctx;
}
