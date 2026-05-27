import type { Router } from "expo-router";
import type { BookParams } from "./booking";

export function openBook(router: Router, params: BookParams = {}) {
  router.push({
    pathname: "/book",
    params: {
      ...(params.service ? { service: params.service } : {}),
      ...(params.package !== undefined
        ? { package: String(params.package) }
        : {}),
      ...(params.promo ? { promo: params.promo } : {}),
    },
  });
}
