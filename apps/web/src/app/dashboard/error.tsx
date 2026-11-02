"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description={error.digest ? `We couldn't load this page. Reference: ${error.digest}` : "We couldn't load this page. Please try again."}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
