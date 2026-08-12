import { useEffect, useRef, useState } from "react";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import { startupMark } from "@/lib/startup-trace";

const FONT_LOAD_TIMEOUT_MS = 5000;

export function useServicesFonts() {
  const [loaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);
  const markedRef = useRef(false);

  useEffect(() => {
    if (markedRef.current) return;
    if (loaded || timedOut) {
      markedRef.current = true;
      startupMark("FONTS_READY", loaded ? "loaded" : "timeout-fallback");
    }
  }, [loaded, timedOut]);

  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => {
      if (__DEV__) console.warn("[Homeeigo FONTS] Poppins load timeout — using system fonts");
      setTimedOut(true);
    }, FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded]);

  return loaded || timedOut;
}
