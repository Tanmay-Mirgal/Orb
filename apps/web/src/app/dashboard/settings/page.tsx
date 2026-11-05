import { connectorEnabled, connectorHubName } from "core";
import { SettingsClient } from "@/features/settings/components/SettingsClient";

export const metadata = { title: "Settings" };
// The "Connected apps" tab depends on an environment variable, so this page must not be prerendered at build time.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsClient connector={connectorEnabled() ? { hubName: connectorHubName() } : null} />;
}
