"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Home, MapPin } from "lucide-react";
import { HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";
import { cn } from "@/lib/utils";

const VB = { w: 400, h: 260 };
const PICKUP = { x: 48, y: 210 };
const HOME = { x: 352, y: 42 };

const ROUTE_MID = { x: 208, y: 148 };

/** Done: pickup → rider · Remaining: rider → home */
const TRACK_DONE_D = `M ${PICKUP.x} ${PICKUP.y} C 92 ${PICKUP.y - 6}, 150 178, ${ROUTE_MID.x} ${ROUTE_MID.y}`;
const TRACK_LEFT_D = `M ${ROUTE_MID.x} ${ROUTE_MID.y} S 292 78, ${HOME.x} ${HOME.y}`;
export const TRACK_ROUTE_D = `M ${PICKUP.x} ${PICKUP.y} C 92 204, 150 178, 208 148 S 292 78, ${HOME.x} ${HOME.y}`;

const RIDER_STOPS = [
  { left: 12, top: 81 },
  { left: 28, top: 72 },
  { left: 52, top: 57 },
  { left: 70, top: 40 },
  { left: 78, top: 32 },
] as const;

type LiveTrackingMapViewProps = {
  className?: string;
};

export function LiveTrackingMapView({ className }: LiveTrackingMapViewProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <div
      className={cn("relative min-h-0 w-full overflow-hidden", className)}
      role="img"
      aria-label="Live map showing route from pickup to your home with bike rider"
    >
      <div className="absolute inset-0 bg-[#e7ebe8]" />

      <svg
        className="absolute inset-0 size-full"
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="track-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="50%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="130" height="100" fill="#d4ead9" rx="3" />
        <rect x="265" y="155" width="135" height="105" fill="#d4ead9" rx="3" />
        <rect x="150" y="0" width="95" height="75" fill="#dde4ea" rx="2" />
        <rect x="0" y="120" width="75" height="140" fill="#dde4ea" rx="2" />
        <rect x="290" y="0" width="110" height="88" fill="#dde4ea" rx="2" />
        <path d="M 0 130 L 400 130" stroke="#fff" strokeWidth="16" strokeLinecap="round" />
        <path d="M 200 0 L 200 260" stroke="#fff" strokeWidth="13" strokeLinecap="round" />
        <path d="M 0 65 L 400 65" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />
        <path d="M 0 195 L 320 195" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" />

        {/* Remaining: rider → home (dashed) */}
        <path
          d={TRACK_LEFT_D}
          fill="none"
          stroke="#64748b"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="10 9"
        />

        {/* Completed: pickup → rider (solid) */}
        <motion.path
          d={TRACK_DONE_D}
          fill="none"
          stroke="url(#track-grad)"
          strokeWidth="7"
          strokeLinecap="round"
          initial={reduce ? undefined : { pathLength: 0 }}
          whileInView={reduce ? undefined : { pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: "drop-shadow(0 2px 8px rgb(37 99 235 / 0.4))" }}
        />
      </svg>

      {/* Pickup — on route start */}
      <span
        className="absolute z-[3] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        style={{ left: `${(PICKUP.x / VB.w) * 100}%`, top: `${(PICKUP.y / VB.h) * 100}%` }}
      >
        <span className="grid size-7 place-items-center rounded-full bg-emerald-500 text-white shadow-md ring-2 ring-white sm:size-9">
          <MapPin size={13} className="fill-white sm:size-4" />
        </span>
        <span className="mt-0.5 hidden rounded-md bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 shadow-sm min-[380px]:block sm:mt-1">
          Pickup
        </span>
      </span>

      {/* Home — on route end */}
      <span
        className="absolute z-[3] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        style={{ left: `${(HOME.x / VB.w) * 100}%`, top: `${(HOME.y / VB.h) * 100}%` }}
      >
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-white shadow-md ring-2 ring-white sm:size-9 sm:rounded-xl">
          <Home size={13} className="sm:size-4" />
        </span>
        <span className="mt-0.5 hidden rounded-md bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 shadow-sm min-[380px]:block sm:mt-1">
          Home
        </span>
      </span>

      {/* Rider on the track */}
      <motion.div
        className="absolute z-[4] flex -translate-x-1/2 -translate-y-[85%] flex-col items-center"
        animate={
          reduce
            ? { left: `${RIDER_STOPS[2].left}%`, top: `${RIDER_STOPS[2].top}%` }
            : {
                left: RIDER_STOPS.map((s) => `${s.left}%`),
                top: RIDER_STOPS.map((s) => `${s.top}%`),
              }
        }
        transition={{
          duration: 6,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
        }}
      >
        <motion.div
          animate={reduce ? undefined : { y: [0, -4, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="flex flex-col items-center"
        >
          <span className="grid size-11 place-items-center rounded-full bg-white shadow-[0_10px_28px_rgb(37_99_235/0.4)] ring-2 ring-primary sm:size-[3.75rem] sm:ring-[3px]">
            <Image
              src={HOMIGO_RIDER_IMAGE}
              alt="HOMIGO rider on bike"
              width={56}
              height={56}
              sizes="56px"
              className="size-10 object-contain sm:size-14"
            />
          </span>
          <span className="mt-1 rounded-md bg-primary px-2 py-px text-[9px] font-bold text-white shadow-md sm:mt-1.5 sm:rounded-lg sm:px-2.5 sm:py-0.5 sm:text-[10px]">
            On bike
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
