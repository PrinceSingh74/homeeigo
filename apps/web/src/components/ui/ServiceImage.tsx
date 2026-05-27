import Image from "next/image";
import { cn } from "@/lib/utils";

type ServiceImageProps = {
  src: string;
  alt: string;
  className?: string;
  /** Used when not in fill mode */
  size?: number;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  objectFit?: "contain" | "cover";
};

/** Optimized service / catalog imagery (local or remote). */
export function ServiceImage({
  src,
  alt,
  className,
  size = 40,
  fill,
  sizes,
  priority,
  objectFit = "contain",
}: ServiceImageProps) {
  const fitClass = objectFit === "cover" ? "object-cover" : "object-contain";

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes ?? "100vw"}
        className={cn(fitClass, className)}
        priority={priority}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      sizes={sizes ?? `${size}px`}
      className={className}
      priority={priority}
    />
  );
}
