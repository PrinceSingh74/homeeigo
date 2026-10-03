import Image from "next/image";
import { cn } from "@/lib/utils";

export function HomeHelpPhoto({
  src,
  alt,
  className,
  sizes,
  priority,
  position = "object-[50%_18%]",
}: {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
  position?: string;
}) {
  return (
    <span className={cn("relative isolate block overflow-hidden bg-[#eef3ef]", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className={cn("object-cover", position)}
      />
    </span>
  );
}
