export const ADMIN_KPIS = {
  gmvToday: 1240000,
  gmvWeek: 8420000,
  bookingsToday: 892,
  activeVendors: 2840,
  onlineVendors: 412,
  customers: 12840,
  newCustomersToday: 186,
  revenueMargin: 18.4,
  fraudFlags: 3,
  pendingPayouts: 840000,
  aiJobsProcessed: 4521,
};

export const RECENT_BOOKINGS = [
  { id: "BK-8921", customer: "Priya S.", vendor: "Rajesh K.", service: "AC Repair", amount: 680, status: "in_progress" },
  { id: "BK-8920", customer: "Amit V.", vendor: "Suresh M.", service: "Plumbing", amount: 450, status: "completed" },
  { id: "BK-8919", customer: "Neha G.", vendor: "—", service: "Cleaning", amount: 1200, status: "requested" },
  { id: "BK-8918", customer: "Rohan D.", vendor: "Anil P.", service: "Electrical", amount: 520, status: "cancelled" },
];

export const VENDOR_ROWS = [
  { id: "V-101", name: "Rajesh Kumar", category: "AC Repair", rating: 4.92, jobs: 1247, status: "active", kyc: "verified" },
  { id: "V-102", name: "Suresh Mehta", category: "Plumbing", rating: 4.78, jobs: 890, status: "active", kyc: "verified" },
  { id: "V-103", name: "Kiran Das", category: "Cleaning", rating: 4.65, jobs: 412, status: "review", kyc: "pending" },
];

export const FRAUD_ALERTS = [
  { id: "F-1", type: "Duplicate payout", entity: "Vendor V-882", severity: "high", time: "12 min ago" },
  { id: "F-2", type: "GPS mismatch", entity: "Booking BK-8810", severity: "medium", time: "1 hr ago" },
  { id: "F-3", type: "Unusual refund", entity: "Customer C-4421", severity: "low", time: "3 hr ago" },
];
