"use client";

import { useEffect, useState } from "react";

const MOBILE_MQ = "(max-width: 639px)";
const TABLET_MQ = "(max-width: 1023px)";

export function useIsMobile() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return mobile;
}

export function useIsBelowLg() {
  const [below, setBelow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(TABLET_MQ);
    const sync = () => setBelow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return below;
}
