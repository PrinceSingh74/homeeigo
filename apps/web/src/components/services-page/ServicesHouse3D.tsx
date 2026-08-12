"use client";

import { useRef, useCallback } from "react";
import Image from "next/image";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  m as motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import {
  FLOATING_SERVICES,
  HOUSE_3D_SRC,
} from "@/lib/services-page-data";
import { SERVICES_IMAGE_QUALITY } from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

const FLOAT_POSITIONS = [
  "left-[0%] top-[4%] sm:left-[4%] sm:top-[8%]",
  "left-[28%] top-[-2%] sm:left-[38%] sm:top-[2%]",
  "right-[2%] top-[18%] sm:right-[8%] sm:top-[28%]",
  "right-[-2%] bottom-[26%] sm:right-[2%] sm:bottom-[32%]",
] as const;

export function ServicesHouse3D() {
  const { book } = useServicesNavigation();
  const stageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 80, damping: 22 });
  const springY = useSpring(pointerY, { stiffness: 80, damping: 22 });
  const rotateY = useTransform(springX, [-0.5, 0.5], [-8, 8]);
  const rotateX = useTransform(springY, [-0.5, 0.5], [6, -6]);
  const translateZ = useTransform(springY, [-0.5, 0.5], [0, 12]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduceMotion || !stageRef.current) return;
      if (e.pointerType === "touch") return;
      const rect = stageRef.current.getBoundingClientRect();
      pointerX.set((e.clientX - rect.left) / rect.width - 0.5);
      pointerY.set((e.clientY - rect.top) / rect.height - 0.5);
    },
    [pointerX, pointerY, reduceMotion],
  );

  const onPointerLeave = useCallback(() => {
    pointerX.set(0);
    pointerY.set(0);
  }, [pointerX, pointerY]);

  return (
    <motion.div
      ref={stageRef}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.15, duration: 0.85, ease: [0.34, 1.56, 0.64, 1] }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        "svc-stage-3d relative mx-auto w-full",
        "aspect-[11/10] min-h-[200px] max-w-[280px]",
        "min-[360px]:max-w-[320px] min-[400px]:max-w-[360px]",
        "sm:max-w-[420px] md:max-w-[500px] lg:mx-0 lg:max-w-[560px] xl:max-w-[640px]",
      )}
    >
      <div className="svc-halo-ring" aria-hidden />
      <div className="svc-house-glow" aria-hidden />

      <motion.div
        className="svc-house-layer relative flex h-full w-full items-center justify-center"
        style={
          reduceMotion
            ? undefined
            : { rotateX, rotateY, translateZ, transformStyle: "preserve-3d" }
        }
      >
        <div className="relative w-full animate-float-soft">
          <Image
            src={HOUSE_3D_SRC}
            alt="Premium 3D modern home with services"
            width={1920}
            height={1750}
            priority
            quality={SERVICES_IMAGE_QUALITY}
            sizes="(max-width: 640px) 88vw, (max-width: 1024px) 50vw, 640px"
            className="svc-house-img relative z-10 h-auto w-full select-none"
            draggable={false}
          />
          <div className="svc-house-reflection" aria-hidden />

          {FLOATING_SERVICES.map((svc, i) => {
            const Icon = svc.icon;
            return (
              <motion.button
                key={svc.label}
                type="button"
                onClick={() => book({ service: svc.serviceId })}
                aria-label={svc.label}
                className={cn(
                  "svc-pill-3d absolute z-20 flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/80 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur-md transition hover:scale-105 hover:shadow-xl active:scale-95 sm:gap-2.5 sm:rounded-xl sm:px-3.5 sm:py-2.5 dark:border-white/20 dark:bg-slate-900/90",
                  FLOAT_POSITIONS[i],
                )}
                animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
                transition={{
                  duration: 3 + i * 0.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: svc.delay,
                }}
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md sm:size-10 sm:rounded-lg"
                  style={{
                    backgroundColor: `${svc.color}22`,
                    boxShadow: `0 4px 12px ${svc.color}33`,
                  }}
                >
                  <Icon
                    size={16}
                    className="sm:hidden"
                    style={{ color: svc.color }}
                    aria-hidden
                  />
                  <Icon
                    size={20}
                    className="hidden sm:block"
                    style={{ color: svc.color }}
                    aria-hidden
                  />
                </span>
                <span className="hidden text-xs font-bold text-content min-[420px]:inline">
                  {svc.label}
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
