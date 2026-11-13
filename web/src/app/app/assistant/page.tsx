"use client";

import { PageHeader } from "@/components/app/shell";
import { AssistantChat } from "@/components/assistant/chat";

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        title="Ask Flow"
        description="Plain-language answers about MezoFlow's strategies, risks and your own positions, using live data from Mezo Testnet. Flow can suggest where to go next, but only you can move your funds."
      />
      <AssistantChat />
    </>
  );
}
