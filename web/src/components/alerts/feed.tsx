"use client";

import Link from "next/link";
import { useState } from "react";
import type { Alert, AlertSeverity } from "@/hooks/useAlerts";
import { timeAgo } from "@/lib/format";
import { Skel, useNow } from "@/components/ui";

export const SEVERITY: Record<AlertSeverity, { label: string; glyph: string; dot: string; text: string }> = {
  success: { label: "Done", glyph: "✓", dot: "bg-tide", text: "text-tide" },
  info: { label: "Info", glyph: "i", dot: "bg-mist", text: "text-mist" },
  warning: { label: "Warning", glyph: "!", dot: "bg-sun", text: "text-sun" },
  critical: { label: "Action needed", glyph: "!", dot: "bg-coral", text: "text-coral" },
};

export function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY[severity];
  return (
    <span aria-hidden className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold text-white ${s.dot}`}>
      {s.glyph}
    </span>
  );
}

export function AlertFeed({
  alerts,
  readIds,
  onRead,
  loading,
  emptyBody,
}: {
  alerts: Alert[];
  readIds: Set<string>;
  onRead: (id: string) => void;
  loading?: boolean;
  emptyBody: string;
}) {
  const now = useNow(30_000);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const shown = filter === "unread" ? alerts.filter((a) => !readIds.has(a.id)) : alerts;
  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-5 py-4">
        <h2 className="font-semibold">Notifications</h2>
        <div className="seg" role="tablist" aria-label="Filter notifications">
          <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          <button role="tab" aria-selected={filter === "unread"} onClick={() => setFilter("unread")}>
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
        </div>
      </div>

      {loading && alerts.length === 0 ? (
        <div className="grid gap-3 p-5">
          <Skel w="100%" h="3.5rem" />
          <Skel w="100%" h="3.5rem" />
        </div>
      ) : shown.length === 0 ? (
        <div className="px-5 py-12">
          <p className="font-semibold">{filter === "unread" ? "You're all caught up" : "No notifications yet"}</p>
          <p className="mt-1 max-w-[48ch] text-sm text-silt">{filter === "unread" ? "Everything here has been read." : emptyBody}</p>
        </div>
      ) : (
        <ul className="divide-y divide-shoal/70">
          {shown.map((a) => {
            const unread = !readIds.has(a.id);
            const s = SEVERITY[a.severity];
            const body = (
              <>
                <SeverityIcon severity={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className={`font-semibold ${unread ? "text-foam" : "text-mist"}`}>{a.title}</p>
                    <span className={`text-xs font-semibold ${s.text}`}>{s.label}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-silt">{a.body}</p>
                </div>
                <div className="flex flex-none flex-col items-end gap-2">
                  <span className="whitespace-nowrap text-xs text-silt tabular">
                    {a.live ? "Now" : now ? timeAgo(a.timestamp, now) : ""}
                  </span>
                  {unread && (
                    <span className="h-2 w-2 rounded-full bg-tide" aria-label="Unread" role="img" />
                  )}
                </div>
              </>
            );
            const cls = `flex gap-4 px-5 py-4 transition-colors hover:bg-shoal/30 ${unread ? "bg-shoal/15" : ""}`;
            return (
              <li key={a.id}>
                {a.href ? (
                  <Link href={a.href} className={cls} onClick={() => onRead(a.id)}>
                    {body}
                  </Link>
                ) : (
                  <button type="button" className={`${cls} w-full text-left`} onClick={() => onRead(a.id)}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
