import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Service } from "@/lib/services";

const SERVICES_KEY = "homigo_catalog_services_v1";
const FEATURED_KEY = "homigo_catalog_featured_v1";
const SYNCED_AT_KEY = "homigo_catalog_synced_at_v1";

export type CatalogCacheMeta = {
  syncedAt: string | null;
  count: number;
};

export async function loadCatalogCache(): Promise<Service[]> {
  try {
    const raw = await AsyncStorage.getItem(SERVICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Service[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadFeaturedCache(): Promise<Service[]> {
  try {
    const raw = await AsyncStorage.getItem(FEATURED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Service[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveCatalogCache(services: Service[]): Promise<void> {
  if (!services.length) return;
  const ts = new Date().toISOString();
  await AsyncStorage.multiSet([
    [SERVICES_KEY, JSON.stringify(services)],
    [SYNCED_AT_KEY, ts],
  ]);
}

export async function saveFeaturedCache(services: Service[]): Promise<void> {
  if (!services.length) return;
  await AsyncStorage.setItem(FEATURED_KEY, JSON.stringify(services));
}

export async function getCatalogCacheMeta(): Promise<CatalogCacheMeta> {
  const [servicesRaw, syncedAt] = await AsyncStorage.multiGet([SERVICES_KEY, SYNCED_AT_KEY]);
  let count = 0;
  try {
    const parsed = JSON.parse(servicesRaw[1] ?? "[]") as Service[];
    count = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    count = 0;
  }
  return { syncedAt: syncedAt[1], count };
}
