"use client";

import Image, { type ImageProps } from "next/image";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type MotionImageProps = ImageProps &
  Pick<
    HTMLMotionProps<"div">,
    "animate" | "initial" | "transition" | "whileHover" | "whileTap"
  > & {
    /** Size/position classes on the motion wrapper (e.g. `size-56 lg:size-64`) */
    wrapperClassName?: string;
  };

/** Decorative image with framer-motion on a sized wrapper (uses next/image). */
export function MotionImage({
  className,
  wrapperClassName,
  animate,
  initial,
  transition,
  whileHover,
  whileTap,
  alt,
  fill = true,
  sizes,
  ...props
}: MotionImageProps) {
  return (
    <motion.div
      className={cn("relative", wrapperClassName)}
      animate={animate}
      initial={initial}
      transition={transition}
      whileHover={whileHover}
      whileTap={whileTap}
    >
      <Image
        alt={alt}
        fill={fill}
        sizes={sizes ?? "100vw"}
        className={cn("object-contain", className)}
        {...props}
      />
    </motion.div>
  );
}
