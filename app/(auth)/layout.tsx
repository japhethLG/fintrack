export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-dark-900 overflow-x-hidden overflow-y-auto py-6 sm:py-8">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Gradient orbs - smaller on mobile */}
        <div className="absolute top-1/4 left-0 sm:left-1/4 w-48 sm:w-96 h-48 sm:h-96 bg-primary/20 rounded-full blur-3xl animate-pulse -translate-x-1/2 sm:translate-x-0" />
        <div
          className="absolute bottom-1/4 right-0 sm:right-1/4 w-40 sm:w-80 h-40 sm:h-80 bg-blue-500/15 rounded-full blur-3xl animate-pulse translate-x-1/2 sm:translate-x-0"
          style={{ animationDelay: "1s" }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 sm:w-[600px] h-80 sm:h-[600px] bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Content - better mobile padding */}
      <div className="relative z-10 w-full max-w-md px-4 sm:px-6">{children}</div>
    </div>
  );
}
