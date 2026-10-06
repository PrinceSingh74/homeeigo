/**
 * Static content for the /ai page: shortcuts only.
 *
 * This file used to hold a demo household — a named member with a stock portrait, a home
 * health score, AC efficiency, an energy bill, water and safety readings, "insights" quoting days
 * and savings, and a canned diagnosis conversation. No sensor, model or endpoint produced any of
 * it, and it was shown to every signed-in customer as their own home. It is gone: the page greets
 * the signed-in customer by their own name and shows home monitoring as not yet available.
 */

export const AI_SMART_ACTIONS = [
  {
    id: "cleaning",
    title: "Book\nCleaning",
    gradient: "from-emerald-500 to-emerald-700",
    href: "/book?service=deep-cleaning",
  },
  {
    id: "ac",
    title: "Diagnose\nAC",
    gradient: "from-teal-400 to-teal-600",
    prompt: "AC cooling kam kar raha hai",
  },
  {
    id: "leak",
    title: "Detect\nLeakage",
    gradient: "from-teal-500 to-teal-700",
    prompt: "Check for water leakage in my home",
  },
  {
    id: "pest",
    title: "Pest\nScan",
    gradient: "from-teal-500 to-emerald-600",
    href: "/book?service=pest-control",
  },
  {
    id: "schedule",
    title: "Smart\nScheduling",
    gradient: "from-emerald-500 to-green-600",
    prompt: "Schedule my home services",
  },
  {
    id: "deep-clean",
    title: "AI Deep\nClean",
    gradient: "from-emerald-500 to-teal-500",
    href: "/book?service=deep-cleaning",
  },
] as const;

/** A shortcut to one service's booking page. A link, not a recommendation or a ranking. */
export const AI_RECOMMENDED = {
  id: "ac-service",
  title: "AC General Service",
  image: "/svc-ac.png",
  href: "/book?service=ac-service",
} as const;

/** Booking shortcuts by service. Labels name the service; none states that anything is due. */
export const AI_PREDICTIONS = [
  { id: "deep", label: "Deep Cleaning", gradient: "from-teal-500 to-emerald-600" },
  { id: "filter", label: "Water Filter", gradient: "from-emerald-500 to-teal-600" },
  { id: "ac", label: "AC Service", gradient: "from-teal-400 to-teal-600" },
  { id: "pest", label: "Pest Control", gradient: "from-emerald-500 to-green-600" },
] as const;

export function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}
