export type BookingRequest = {
  id: string;
  customerName: string;
  serviceType: string;
  category: string;
  distanceKm: number;
  earnings: number;
  etaMin: number;
  address: string;
  urgency: "normal" | "high";
  createdAt: string;
  isNew?: boolean;
};

export type ScheduleItem = {
  id: string;
  time: string;
  service: string;
  status: "completed" | "upcoming";
  earning: number;
};

export type RecentActivity = {
  id: string;
  customerName: string;
  service: string;
  amount: number;
  time: string;
};

export type PartnerReview = {
  id: string;
  customerName: string;
  rating: number;
  text: string;
  tip?: number;
  category: string;
  date: string;
};

export const DEMO_VENDOR = {
  id: "vnd_001",
  name: "Rahul Sharma",
  phone: "+91 98765 43210",
  rating: 4.8,
  reviewCount: 320,
  completedJobs: 1240,
  kycStatus: "verified" as const,
  categories: ["AC Repair", "Deep Cleaning", "Plumbing"],
  online: true,
  city: "Noida",
  avatarInitials: "RS",
};

export const DEMO_DASHBOARD = {
  todayEarnings: 4850,
  todayEarningsChange: 12.5,
  weeklyEarnings: 18650,
  weeklyEarningsChange: -15.3,
  monthlyEarnings: 54320,
  lifetimeEarnings: 124850,
  incentivesEarned: 7320,
  completedToday: 12,
  completedTodayDelta: 2,
  pendingRequests: 3,
  rating: 4.8,
  acceptanceRate: 92,
  responseRate: 95,
  onTimeRate: 90,
  cancellationRate: 2,
  completionRate: 92,
  bonusJobsRemaining: 2,
  sparkline: [3200, 3800, 4100, 3950, 4200, 4500, 4850],
};

export const DEMO_REQUESTS: BookingRequest[] = [
  {
    id: "req_1",
    customerName: "Priya Verma",
    serviceType: "Deep Cleaning",
    category: "Cleaning",
    distanceKm: 2.4,
    earnings: 799,
    etaMin: 12,
    address: "Sector 62, Noida",
    urgency: "high",
    createdAt: "2 min ago",
    isNew: true,
  },
  {
    id: "req_2",
    customerName: "Amit Singh",
    serviceType: "AC Service",
    category: "AC Repair",
    distanceKm: 3.1,
    earnings: 650,
    etaMin: 15,
    address: "Sector 45, Noida",
    urgency: "normal",
    createdAt: "5 min ago",
    isNew: true,
  },
  {
    id: "req_3",
    customerName: "Neha Kumari",
    serviceType: "Plumbing Repair",
    category: "Plumbing",
    distanceKm: 4.6,
    earnings: 550,
    etaMin: 18,
    address: "Sector 18, Noida",
    urgency: "normal",
    createdAt: "8 min ago",
    isNew: true,
  },
];

export const DEMO_SCHEDULE: ScheduleItem[] = [
  {
    id: "sch_1",
    time: "10:00 AM",
    service: "AC Installation",
    status: "completed",
    earning: 1200,
  },
  {
    id: "sch_2",
    time: "12:30 PM",
    service: "AC Repair",
    status: "upcoming",
    earning: 850,
  },
  {
    id: "sch_3",
    time: "02:00 PM",
    service: "Deep Cleaning",
    status: "upcoming",
    earning: 650,
  },
  {
    id: "sch_4",
    time: "04:30 PM",
    service: "Plumbing Repair",
    status: "upcoming",
    earning: 550,
  },
];

export const DEMO_WEEKLY_EARNINGS = [
  { day: "Mon", amount: 2400 },
  { day: "Tue", amount: 3100 },
  { day: "Wed", amount: 2800 },
  { day: "Thu", amount: 3500 },
  { day: "Fri", amount: 3200 },
  { day: "Sat", amount: 2900 },
  { day: "Sun", amount: 2650 },
];

export const DEMO_ACTIVE_JOB = {
  customerName: "Priya Verma",
  service: "Deep Cleaning",
  amount: 799,
  etaMin: 12,
};

export const DEMO_RECENT_ACTIVITY: RecentActivity[] = [
  {
    id: "act_1",
    customerName: "Priya Verma",
    service: "Deep Cleaning Completed",
    amount: 799,
    time: "Today, 09:45 AM",
  },
  {
    id: "act_2",
    customerName: "Amit Singh",
    service: "AC Service Completed",
    amount: 650,
    time: "Today, 08:30 AM",
  },
  {
    id: "act_3",
    customerName: "Suresh Patel",
    service: "Plumbing Completed",
    amount: 480,
    time: "Yesterday, 06:15 PM",
  },
];

export const DEMO_AI_INSIGHTS = {
  headline:
    "High demand for AC services in your area. You can earn up to ₹1,500 more today!",
  suggestions: [
    { id: "s1", text: "Accept nearby AC jobs", icon: "star" as const },
    { id: "s2", text: "Optimize your route", icon: "route" as const },
    { id: "s3", text: "Peak hours: 10 AM – 2 PM", icon: "clock" as const },
  ],
};

export const DEMO_AI_INSIGHTS_LIST = [
  {
    id: "ai_1",
    title: "Accept nearby AC jobs",
    body: "3 AC requests within 3 km — 18% higher earnings vs your weekly average.",
    type: "earn" as const,
  },
  {
    id: "ai_2",
    title: "Peak window 10 AM – 2 PM",
    body: "Schedule breaks before 4 PM. Demand spikes 34% in your zone today.",
    type: "schedule" as const,
  },
  {
    id: "ai_3",
    title: "Route optimization",
    body: "Cluster Sector 45 jobs to save 22 min travel and +₹340 potential.",
    type: "route" as const,
  },
];

export const DEMO_REVIEWS: PartnerReview[] = [
  {
    id: "rev_1",
    customerName: "Ananya R.",
    rating: 5,
    text: "Professional, on time, fixed AC in 40 mins. Highly recommend.",
    tip: 100,
    category: "AC Repair",
    date: "Yesterday",
  },
  {
    id: "rev_2",
    customerName: "Vikram S.",
    rating: 5,
    text: "Explained the issue clearly. Fair pricing.",
    category: "Appliance",
    date: "2 days ago",
  },
  {
    id: "rev_3",
    customerName: "Meera K.",
    rating: 4,
    text: "Good work. Arrived 10 min late but quality was excellent.",
    tip: 50,
    category: "Electrical",
    date: "4 days ago",
  },
];

export const DEMO_WALLET = {
  balance: 12480,
  today: 4850,
  week: 18650,
  incentives: 7320,
  pendingPayout: 0,
};

export const DEMO_ANALYTICS = {
  ratings: 4.8,
  completionRate: 92,
  responseRate: 95,
  onTimeRate: 90,
  cancellationRate: 2,
  weeklyJobs: [4, 6, 5, 8, 7, 6, 9],
  weeklyEarnings: [2400, 3100, 2800, 3500, 3200, 2900, 2650],
};

export function formatInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}
