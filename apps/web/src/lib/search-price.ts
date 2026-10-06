/** "From ₹N" for the lowest positive price the server holds for a service, or `null` when it holds none. */
export function searchPriceLabel(service: { basePrice?: number | null; minPrice?: number | null }): string | null {
  const prices = [service.minPrice, service.basePrice].filter((p): p is number => typeof p === "number" && p > 0);
  if (prices.length === 0) return null;
  return `From ₹${Math.min(...prices).toLocaleString("en-IN")}`;
}
