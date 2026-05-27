import { AdminSidebar } from "./AdminSidebar";
import { AdminTopBar } from "./AdminTopBar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <AdminSidebar />
      <div className="flex min-h-dvh flex-1 flex-col">
        <AdminTopBar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
