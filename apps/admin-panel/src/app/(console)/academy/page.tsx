"use client";

import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";

export default function AcademyAdminPage() {
  const modules = useQuery({
    queryKey: ["admin", "academy"],
    queryFn: () => adminApi.academyModules(),
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Partner Academy CMS</h1>
        <p className="text-sm text-muted-foreground">Training modules published to the partner app.</p>
      </div>
      <div className="space-y-2">
        {(modules.data?.modules as Array<{ id: string; title: string; contentType: string; isPublished: boolean }> ?? []).map((m) => (
          <article key={m.id} className="rounded-lg border bg-card px-4 py-3 text-sm">
            <p className="font-semibold">{m.title}</p>
            <p className="text-muted-foreground">{m.contentType} · {m.isPublished ? "Published" : "Draft"}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
