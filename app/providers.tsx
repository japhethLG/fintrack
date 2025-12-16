"use client";

import { AuthProvider } from "./contexts/AuthContext";
import { FinancialProvider } from "./contexts/FinancialContext";
import { ModalProvider } from "./components/modals";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <FinancialProvider>
        <ModalProvider>{children}</ModalProvider>
      </FinancialProvider>
    </AuthProvider>
  );
}
