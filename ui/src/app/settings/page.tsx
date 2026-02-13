import SectionCard from "@/components/SectionCard";
import SettingsForm from "@/components/SettingsForm";
import SiteHeader from "@/components/SiteHeader";
import ThreeColumnLayout from "@/components/ThreeColumnLayout";

export default function SettingsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <ThreeColumnLayout
        left={
          <SectionCard title="Local setup" subtitle="Server-side overrides">
            <div className="space-y-3 text-sm text-muted">
              <p>Point the UI to a local API and select a forum to browse.</p>
              <p>
                These values override environment variables and are stored in
                cookies.
              </p>
            </div>
          </SectionCard>
        }
        main={
          <SectionCard title="Connection settings" subtitle="Local testing">
            <SettingsForm />
          </SectionCard>
        }
        right={
          <SectionCard title="Tips" subtitle="Quick checklist">
            <ul className="space-y-2 text-sm text-muted">
              <li>Start the API on port 3000.</li>
              <li>Copy a forum UUID from the API response.</li>
              <li>Use an agent/admin JWT for protected routes.</li>
            </ul>
          </SectionCard>
        }
      />
    </div>
  );
}
