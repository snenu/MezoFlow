"use client";

import { useAccount } from "@/hooks/useAccount";
import { ConnectPrompt, PageHeader } from "@/components/app/shell";
import { useAlerts } from "@/hooks/useAlerts";
import { AlertFeed } from "@/components/alerts/feed";
import { PreferencesForm } from "@/components/alerts/preferences";

export default function AlertsPage() {
  const { isConnected, address } = useAccount();
  const { alerts, all, unread, readIds, markAllRead, markRead, prefs, isDefault } = useAlerts();

  // Disconnected visitors still see protocol-wide notices from the registry.
  const shown = isConnected ? alerts : all.filter((a) => a.id.startsWith("ann-") || a.id.startsWith("sp-") || a.id.startsWith("icr-"));

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Deposits, withdrawals, rate changes, risk limits and protocol notices, built from on-chain data and filtered by the preferences you save on-chain."
        actions={
          isConnected ? (
            <button className="btn btn-ghost" onClick={markAllRead} disabled={unread === 0}>
              Mark all as read
            </button>
          ) : undefined
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <AlertFeed
          alerts={shown}
          readIds={isConnected ? readIds : new Set(shown.map((a) => a.id))}
          onRead={markRead}
          emptyBody={
            isConnected
              ? "Make a deposit or change your preferences, and updates about your MUSD will appear here."
              : "Connect a wallet to see alerts about your own positions."
          }
        />
        <div className="lg:sticky lg:top-24">
          {isConnected && address ? (
            <PreferencesForm key={`${address}-${prefs.updatedAt}`} prefs={prefs} isDefault={isDefault} />
          ) : (
            <ConnectPrompt
              title="Choose what you hear about"
              body="Connect a wallet to save alert preferences on-chain. They're stored against your address in the AlertCenter contract."
            />
          )}
        </div>
      </div>
    </>
  );
}
