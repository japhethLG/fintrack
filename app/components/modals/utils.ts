"use client";

import type { ReactNode } from "react";

// Modal data types for each modal
import type { IModalData as ConfirmModalData } from "./components/ConfirmModal";
import type { IModalData as SelectiveResetModalData } from "./components/SelectiveResetModal";
import type { IModalData as OverdueTransactionsModalData } from "./components/OverdueTransactionsModal";
import type { IModalData as CompleteTransactionModalData } from "./components/CompleteTransactionModal";

// ============================================================================
// TYPES
// ============================================================================

export type TModalName = keyof IModalData;

// To register a new modal:
// 1) Add its name with a path to its required props interface here
export interface IModalData {
  ConfirmModal: ConfirmModalData;
  SelectiveResetModal: SelectiveResetModalData;
  OverdueTransactionsModal: OverdueTransactionsModalData;
  CompleteTransactionModal: CompleteTransactionModalData;
}

export interface IModal<TModal extends TModalName> {
  isOpen?: boolean;
  title?: string;
  modalData?: IModalData[TModal];
}

export type TModalWidth = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

export type TModalState = {
  [TModal in TModalName]: {
    isOpen?: boolean;
    title?: string;
    modalData?: IModal<TModal>;
    width?: TModalWidth;
    closable?: boolean;
    className?: string;
    centered?: boolean;
    isHidden?: boolean;
  };
};

// ============================================================================
// COMPONENT MAP (Lazy Loading)
// ============================================================================

// 2) Add import function to the componentMap for code splitting
export const componentMap: {
  [key in TModalName]: () => Promise<{ default: React.ComponentType<any> }>;
} = {
  ConfirmModal: () => import("./components/ConfirmModal"),
  SelectiveResetModal: () => import("./components/SelectiveResetModal"),
  OverdueTransactionsModal: () => import("./components/OverdueTransactionsModal"),
  CompleteTransactionModal: () => import("./components/CompleteTransactionModal"),
};

// ============================================================================
// WIDTH VALUES
// ============================================================================

export const widthValues: Record<TModalWidth, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  full: "max-w-full",
};

// ============================================================================
// DEFAULT MODAL CONFIG
// ============================================================================

// 3) Add default config for the modal
export const MODALS: TModalState = {
  ConfirmModal: {
    title: "Confirm",
    width: "md",
  },
  SelectiveResetModal: {
    title: "Selective Data Reset",
    width: "xl",
  },
  OverdueTransactionsModal: {
    title: "Overdue Transactions",
    width: "2xl",
  },
  CompleteTransactionModal: {
    title: "Complete Transaction",
    width: "lg",
  },
};
