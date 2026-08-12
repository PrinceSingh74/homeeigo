import type { Metadata } from "next";
import BookPageClient from "@/app/book/BookPageClient";

export const metadata: Metadata = {
  title: "Book a Service",
  robots: { index: false, follow: false },
};

export default function BookPage() {
  return <BookPageClient />;
}
