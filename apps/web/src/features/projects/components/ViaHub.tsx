"use client";

import { createContext, useContext } from "react";
import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Name of the connected app (the "Hub"), or null while the ecosystem connector is off. */
const ConnectorHubContext = createContext<string | null>(null);

export function ConnectorHubProvider({ hub, children }: { hub: string | null; children: React.ReactNode }) {
  return <ConnectorHubContext.Provider value={hub}>{children}</ConnectorHubContext.Provider>;
}

/** Small tag for projects and deployments that were created through the connector. Renders nothing otherwise. */
export function ViaHubBadge({ via }: { via: string | null | undefined }) {
  const hub = useContext(ConnectorHubContext);
  if (via !== "connector" || !hub) return null;
  return (
    <Badge variant="accent" title={`Created via ${hub}`}>
      <Plug className="size-3" /> via {hub}
    </Badge>
  );
}
