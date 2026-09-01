import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";
import { toneFor, type Tone } from "@/lib/types";

const toneClass: Record<Tone, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  neutral: "border-border bg-muted text-muted-foreground",
};

const dotClass: Record<Tone, string> = {
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  pending: "bg-amber-500",
  neutral: "bg-muted-foreground/50",
};

export function StatusBadge({
  value,
  tone,
  className,
}: {
  value?: string | undefined;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? toneFor(value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        toneClass[resolved],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass[resolved])} aria-hidden="true" />
      {humanize(value) === "—" ? "Unknown" : humanize(value)}
    </span>
  );
}
