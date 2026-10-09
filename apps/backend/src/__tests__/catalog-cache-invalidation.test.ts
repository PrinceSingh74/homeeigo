/**
 * Catalogue writes must drop every list key, not one guessed key.
 * The live key is `catalog:list:v2:<page>:<limit>:…`. The old invalidation
 * deleted `catalog:list:1:100:::::::` which was never written, so an admin
 * edit stayed invisible for LIST_TTL (60s).
 */
import { describe, expect, test } from "bun:test";
import { cacheService } from "../services/cache.service";

describe("catalog cache invalidation", () => {
  test("a prefix drop clears the v2 list key an exact legacy key does not name", async () => {
    const key = `catalog:list:v2:1:100:cache-inv-${Date.now()}`;
    const other = `catalog:featured:cache-inv-${Date.now()}`;
    let listReads = 0;
    let featuredReads = 0;
    const readList = () =>
      cacheService.getOrFetch(key, 60, async () => {
        listReads += 1;
        return { n: listReads };
      }, 30);
    const readFeatured = () =>
      cacheService.getOrFetch(other, 60, async () => {
        featuredReads += 1;
        return { n: featuredReads };
      }, 30);

    expect(await readList()).toEqual({ n: 1 });
    expect(await readList()).toEqual({ n: 1 });
    expect(await readFeatured()).toEqual({ n: 1 });

    await cacheService.invalidate("catalog:list:1:100:::::::");
    expect(await readList()).toEqual({ n: 1 });

    await cacheService.invalidatePrefix("catalog:list:");
    expect(await readList()).toEqual({ n: 2 });
    expect(await readFeatured()).toEqual({ n: 1 });

    await cacheService.invalidate(key);
    await cacheService.invalidate(other);
  });
});
