const U = (id: string, w = 1200) =>
  `https://images.unsplash.com/${id}?w=${w}&q=90&auto=format&fit=crop`;

/**
 * This file once held the whole static "marketplace showcase": service lists with prices, trust
 * points, review statistics, service promises and how-it-works steps. None of it came from the server and,
 * by the second audit, none of it had an importer — it was deleted so it cannot be wired back in.
 * What remains is the row type the live catalogue is mapped into (lib/marketplace-sections) and the
 * city tiles' names and pictures (availability per city is the coverage API's).
 */
export type MarketplaceService = {
  id: string;
  /** Backend catalog slug — stable identifier used to match live services. */
  slug?: string;
  name: string;
  image: string;
  duration: string;
  /** null when there are no real reviews. */
  rating: number | null;
  price: string;
  priceValue?: number;
  badge?: string;
  /** Passed to /book?service=… — the catalog cuid. */
  serviceId: string;
};

export type CityItem = {
  name: string;
  image: string;
};

export const CITIES: CityItem[] = [
  { name: "Bangalore", image: U("photo-1596176530529-78163a4f5af6", 600) },
  { name: "Delhi", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Mumbai", image: U("photo-1566552881560-0be862a7c445", 600) },
  { name: "Pune", image: U("photo-1596178065887-1198b8048ed8", 600) },
  { name: "Gurgaon", image: U("photo-1524492412937-2808ad67581e", 600) },
  { name: "Noida", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Hyderabad", image: U("photo-1596176530529-78163a4f5af6", 600) },
  { name: "Navi Mumbai", image: U("photo-1566552881560-0be862a7c445", 600) },
  { name: "Faridabad", image: U("photo-1524492412937-2808ad67581e", 600) },
  { name: "Ghaziabad", image: U("photo-1587474260584-136574528ed5", 600) },
  { name: "Thane", image: U("photo-1566552881560-0be862a7c445", 600) },
];
