"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectPrompt, PageHeader } from "@/components/app/shell";
import { ActivityTable } from "@/components/activity/activity-table";
import { FaucetButton } from "@/components/app/faucet";
import { Skel, Stat } from "@/components/ui";
import { useMezoFlow, useRecentActivity, useUserEntries } from "@/hooks/useMezoFlow";
import { addressUrl } from "@/lib/chain";
import { ADDR } from "@/lib/contracts";
import { fmtAmount, fmtDate } from "@/lib/format";

type Tab = "mine" | "everyone";

function Totals() {
  const { account } = useMezoFlow();
  const loading = !account;
  const v = (x?: bigint) => (loading || x === undefined ? <Skel w="5rem" /> : `${fmtAmount(x)} MUSD`);
  return (
    <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 border-y rule py-5 sm:grid-cols-4">
      <Stat label="Total deposited" source="ActivityLedger.totals">
        {v(account?.deposited)}
      </Stat>
      <Stat label="Total withdrawn" source="ActivityLedger.totals">
        {v(account?.withdrawn)}
      </Stat>
      <Stat label="Fees and penalties paid" source="ActivityLedger.totals">
        {v(account?.fees)}
      </Stat>
      <Stat
        label="Actions recorded"
        source="ActivityLedger.totals"
        hint={account && Number(account.firstActivity) > 0 ? `Since ${fmtDate(account.firstActivity)}` : undefined}
      >
        {loading ? <Skel w="2rem" /> : account.actions.toString()}
      </Stat>
    </dl>
  );
}

function Mine() {
  const { isConnected } = useAccount();
  const { entries, isLoading } = useUserEntries(500);
  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect a wallet to see your history"
        body="Every deposit, withdrawal, allocation, BTC claim and fee you make through MezoFlow is written to the on-chain activity ledger. Connect to read yours."
      />
    );
  }
  return (
    <>
      <Totals />
      <ActivityTable
        entries={entries}
        loading={isLoading}
        showAccount={false}
        csvName="mezoflow-my-activity.csv"
        emptyTitle="No activity yet"
        emptyBody="Your first deposit, allocation or faucet claim will show up here with a link to its transaction."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/strategies" className="btn btn-primary">
              Browse strategies
            </Link>
            <FaucetButton />
          </div>
        }
      />
    </>
  );
}

function Everyone() {
  const { entries, isLoading } = useRecentActivity(100);
  return (
    <ActivityTable
      entries={entries}
      loading={isLoading}
      showAccount
      csvName="mezoflow-protocol-activity.csv"
      emptyTitle="No activity yet"
      emptyBody="Nobody has used MezoFlow on this deployment yet."
    />
  );
}

export default function ActivityPage() {
  const [tab, setTab] = useState<Tab>("mine");
  return (
    <>
      <PageHeader
        title="Activity"
        description={
          <>
            Every MezoFlow action is recorded by the{" "}
            <a className="link" href={addressUrl(ADDR.ledger)} target="_blank" rel="noreferrer">
              activity ledger contract
            </a>{" "}
            and linked to its transaction on Mezo Testnet.
          </>
        }
        actions={
          <div className="seg" role="tablist" aria-label="Whose activity">
            <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>
              Your activity
            </button>
            <button role="tab" aria-selected={tab === "everyone"} onClick={() => setTab("everyone")}>
              Everyone
            </button>
          </div>
        }
      />
      <div role="tabpanel">{tab === "mine" ? <Mine /> : <Everyone />}</div>
    </>
  );
}
