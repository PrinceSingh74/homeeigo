import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

function handleDeepLink(url: string, router: ReturnType<typeof useRouter>) {
  const parsed = Linking.parse(url);
  const path = parsed.path ?? "";
  const token = parsed.queryParams?.token;

  if (path.includes("reset-password") && typeof token === "string") {
    router.push({ pathname: "/reset-password", params: { token } });
    return;
  }
  if (path.includes("verify-otp")) {
    router.push({
      pathname: "/verify-otp",
      params: parsed.queryParams as Record<string, string>,
    });
    return;
  }
  if (path.includes("bookings")) {
    router.replace("/(tabs)/bookings");
    return;
  }
  if (path.includes("wallet")) {
    router.replace("/(tabs)/wallet");
  }
}

export function useDeepLinking() {
  const router = useRouter();

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url, router);
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      handleDeepLink(url, router);
    });
    return () => sub.remove();
  }, [router]);
}
