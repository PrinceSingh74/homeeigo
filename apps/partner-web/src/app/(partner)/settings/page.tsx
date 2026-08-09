import { SettingsCenter } from "@/components/settings/SettingsCenter";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="text-sm text-partner-muted">
          Account, availability, security, and payment preferences
        </p>
      </div>
      <SettingsCenter />
    </div>
  );
}
