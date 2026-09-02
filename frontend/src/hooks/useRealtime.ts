import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

let activeChannel: RealtimeChannel | null = null;
let subscriberCount = 0;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let currentQueryClient: QueryClient | null = null;

function subscribeChannel(): RealtimeChannel | null {
  if (!supabase) return null;

  // Check if a channel with this topic already exists in the client
  const existing = supabase.getChannels().find(
    (c) => c.topic === "realtime:security-gateway"
  );

  // If a channel already exists and is joined/joining, reuse it safely without re-attaching listeners
  if (existing && (existing.state === "joined" || existing.state === "joining")) {
    return existing;
  }

  // If an old/closed channel exists, remove it before creating a fresh one
  if (existing) {
    void supabase.removeChannel(existing);
  }

  // 1. Channel is created
  const channel = supabase.channel("security-gateway");

  // 2. All postgres_changes listeners are registered BEFORE .subscribe()
  channel
    .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, () => {
      currentQueryClient?.invalidateQueries({ queryKey: ["audit_log"] });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
      currentQueryClient?.invalidateQueries({ queryKey: ["transactions"] });
      currentQueryClient?.invalidateQueries({ queryKey: ["budget_reservations"] });
      currentQueryClient?.invalidateQueries({ queryKey: ["mandates"] });
    });

  // 3. .subscribe() is called ONLY after all listeners are attached
  channel.subscribe();

  return channel;
}

/**
 * Live updates for the two security-critical tables. Any insert or update
 * refreshes the dashboard, transaction state and audit activity.
 *
 * Uses reference-counting and debounced cleanup so that multiple mounting
 * components (and React StrictMode) safely share the single "security-gateway"
 * channel without attempting duplicate subscriptions or registering listeners after subscribe.
 */
export function useSecurityRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase) return;

    // Keep active queryClient reference up to date for query invalidation
    currentQueryClient = queryClient;

    // Cancel any pending unmount cleanup timer (e.g. from React StrictMode or fast navigation)
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }

    subscriberCount++;

    // 5. The same 'security-gateway' channel is not accidentally subscribed multiple times
    if (!activeChannel) {
      activeChannel = subscribeChannel();
    }

    // 4. React cleanup/unsubscribe is handled correctly on unmount
    return () => {
      subscriberCount--;
      if (subscriberCount <= 0) {
        subscriberCount = 0;
        // 6. Debounce channel teardown to handle React StrictMode mount-unmount-mount cycle safely
        cleanupTimer = setTimeout(() => {
          if (subscriberCount <= 0 && activeChannel) {
            const ch = activeChannel;
            activeChannel = null;
            void supabase?.removeChannel(ch);
          }
        }, 150);
      }
    };
  }, [queryClient]);
}

