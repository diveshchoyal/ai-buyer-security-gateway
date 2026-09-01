import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Package,
  FileCheck2,
  Receipt,
  ScrollText,
  Settings,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSecurityRealtime } from "@/hooks/useRealtime";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Package },
  { to: "/mandates", label: "Mandates", icon: FileCheck2 },
  { to: "/transactions", label: "Transactions", icon: Receipt },
  { to: "/audit", label: "Audit Trail", icon: ScrollText },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
      {nav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          activeOptions={{ exact: item.to === "/" }}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          activeProps={{ className: "bg-accent text-foreground" }}
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function SettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/settings"
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      activeProps={{ className: "bg-accent text-foreground" }}
    >
      <Settings className="size-4" aria-hidden="true" />
      Settings
    </Link>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ShieldCheck className="size-4" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">AI Buyer</span>
    </div>
  );
}

function ConnectionDot() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          isSupabaseConfigured ? "bg-emerald-500" : "bg-amber-500",
        )}
        aria-hidden="true"
      />
      {isSupabaseConfigured ? "Gateway connected" : "Backend not configured"}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useSecurityRealtime();
  const title = useRouterState({
    select: (state) => {
      const path = state.location.pathname;
      if (path.startsWith("/purchase")) return "Purchase";
      return nav.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)))?.label ?? "Settings";
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar px-3 py-4 lg:flex">
        <div className="px-2 pb-5">
          <Wordmark />
        </div>
        <NavLinks />
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <SettingsLink />
          <ConnectionDot />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="inline-flex size-9 items-center justify-center rounded-md border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="size-4" aria-hidden="true" />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-sidebar px-3 py-4">
            <div className="flex items-center justify-between px-2 pb-5">
              <Wordmark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-auto flex flex-col gap-2 pt-4">
              <SettingsLink onNavigate={() => setOpen(false)} />
              <ConnectionDot />
            </div>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          <h1 className="sr-only">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
