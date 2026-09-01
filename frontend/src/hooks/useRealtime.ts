import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/**
 * Live updates for the two security-critical tables. Any insert or update
 * refreshes the dashboard, transaction state and audit activity.
 */
export function useSecurityRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel("security-gateway")
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, () => {
        queryClient.invalidateQueries({ queryKey: ["audit_log"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["budget_reservations"] });
        queryClient.invalidateQueries({ queryKey: ["mandates"] });
      })
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient]);
}
