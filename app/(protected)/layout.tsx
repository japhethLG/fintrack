import ProtectedRoute from "@/components/ProtectedRoute";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      {/* Mobile Navigation - Fixed header */}
      <MobileNav />

      <div className="flex h-screen overflow-hidden bg-[#101622] text-white font-sans">
        <Sidebar />

        <main className="flex-1 overflow-y-auto relative pt-16 lg:pt-0">
          {/* Grid Background Effect */}
          <div
            className="absolute inset-0 pointer-events-none opacity-5"
            style={{
              backgroundImage: "radial-gradient(#2d3748 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          ></div>

          <div className="relative z-10">{children}</div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
