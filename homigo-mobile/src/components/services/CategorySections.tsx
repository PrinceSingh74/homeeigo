import React from "react";
import { CategoryRail } from "./CategoryRail";

/**
 * The website services-page category sections, ported 1:1 to the app.
 * Same categories + services as apps/web services-marketplace-data.
 */

export function HomeCareSection() {
  return (
    <CategoryRail
      overline="Everyday"
      title="Home Care"
      subtitle="Daily cleaning essentials for your home"
      items={[
        { name: "Bathroom Cleaning" },
        { name: "Kitchen Cleaning" },
        { name: "Dusting & Wiping" },
        { name: "Sweeping & Mopping" },
      ]}
    />
  );
}

export function PremiumCareSection() {
  return (
    <CategoryRail
      overline="Deep clean"
      title="Premium Care"
      subtitle="Deep cleaning for a healthier home"
      items={[
        { name: "Sofa Deep Cleaning" },
        { name: "Mattress Sanitization" },
        { name: "Carpet Shampooing" },
      ]}
    />
  );
}

export function LaundrySection() {
  return (
    <CategoryRail
      overline="Wardrobe"
      title="Laundry & Wardrobe"
      subtitle="Fresh, clean & perfectly organised"
      items={[
        { name: "Laundry" },
        { name: "Ironing & Folding" },
        { name: "Complete Wardrobe Cleaning" },
      ]}
    />
  );
}

export function OutdoorSection() {
  return (
    <CategoryRail
      overline="Beyond home"
      title="Outdoor"
      subtitle="Care beyond your four walls"
      items={[
        { name: "Balcony Cleaning" },
        { name: "Plant Care" },
        { name: "Car Surface Cleaning" },
      ]}
    />
  );
}

export function ComingSoonSection() {
  return (
    <CategoryRail
      overline="On the way"
      title="Coming Soon"
      subtitle="New services launching in your city"
      soon
      items={[{ name: "Senior Care" }, { name: "Pet Care" }, { name: "Executive Services" }]}
    />
  );
}
