import Image from "next/image";
import { cn } from "@/lib/utils";

type ServiceImageProps = {
  src?: string | null;
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
  const resolved = src?.trim();
  const fitClass = objectFit === "cover" ? "object-cover" : "object-contain";

  if (!resolved) {
    if (fill) {
      return (
        <span
          aria-hidden={!alt}
          className={cn("absolute inset-0 bg-surface/60", className)}
        />
      );
    }
    return (
      <span
        aria-hidden={!alt}
        className={cn("inline-block bg-surface/60", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (fill) {
    return (
      <Image
        src={resolved}
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
      src={resolved}
      alt={alt}
      width={size}
      height={size}
      sizes={sizes ?? `${size}px`}
      className={className}
      priority={priority}
    />
  );
}
