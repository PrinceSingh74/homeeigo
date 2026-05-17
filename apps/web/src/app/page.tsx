import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="bg-canvas">
        <HeroSection />

        {/* Upcoming sections (next checkpoints): Search, Service
            Categories, Feature Banner, Offers, Bottom Nav. */}
        <section className="mx-auto max-w-content px-6 pb-24 text-center">
          <p className="text-sm font-medium tracking-wide text-muted">
            Checkpoint&nbsp;1 — Design system, navigation &amp; hero ✦ more
            sections coming next
          </p>
        </section>
      </main>
    </>
  );
}
