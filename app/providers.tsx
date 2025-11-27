"use client";

import { AuthProvider } from "./contexts/AuthContext";
import { FinancialProvider } from "./contexts/FinancialContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <FinancialProvider>{children}</FinancialProvider>
    </AuthProvider>
  );
}
