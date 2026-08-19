export const ONBOARDING_SERVICES = [
  { id: "cleaning", label: "Cleaning" },
  { id: "plumbing", label: "Plumbing" },
  { id: "ac-repair", label: "AC Repair" },
  { id: "electrician", label: "Electrician" },
  { id: "pest-control", label: "Pest Control" },
  { id: "salon", label: "Salon" },
  { id: "appliance-repair", label: "Appliance Repair" },
] as const;

export const ONBOARDING_CITIES = [
  "Delhi",
  "Mumbai",
  "Bangalore",
  "Hyderabad",
  "Pune",
  "Gurgaon",
  "Noida",
  "Chennai",
  "Kolkata",
  "Others",
] as const;

export const ONBOARDING_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const ONBOARDING_GENDERS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
] as const;

export const MOBILE_STEPPER = [
  { id: "account", label: "Account" },
  { id: "services", label: "Services" },
  { id: "profile", label: "Profile" },
  { id: "location", label: "Location" },
  { id: "availability", label: "Availability" },
  { id: "kyc", label: "KYC" },
  { id: "documents", label: "Documents" },
  { id: "assessment", label: "Assessment" },
  { id: "done", label: "Review" },
] as const;

export function mapSkillToServiceId(skill?: string | null): string | null {
  if (!skill) return null;
  const needle = skill.trim().toLowerCase();
  const match = ONBOARDING_SERVICES.find(
    (s) => s.id === needle || s.label.toLowerCase() === needle,
  );
  return match?.id ?? null;
}

export function mapCityChoice(city?: string | null): string {
  if (!city) return "";
  const needle = city.trim().toLowerCase();
  const match = ONBOARDING_CITIES.find((c) => c.toLowerCase() === needle);
  return match ?? (needle ? "Others" : "");
}

export function stepperIdForStep(step: string): (typeof MOBILE_STEPPER)[number]["id"] {
  if (step === "welcome" || step === "otp" || step === "account") return "account";
  if (step === "services") return "services";
  if (step === "profile") return "profile";
  if (step === "location") return "location";
  if (step === "availability") return "availability";
  if (step === "kyc") return "kyc";
  if (step === "documents") return "documents";
  if (step === "assessment") return "assessment";
  return "done";
}
