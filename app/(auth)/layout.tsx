export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#101622]">
      {/* Grid Background Effect */}
      <div
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: "radial-gradient(#2d3748 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      ></div>
      <div className="relative z-10 w-full max-w-md px-6">{children}</div>
    </div>
  );
}
