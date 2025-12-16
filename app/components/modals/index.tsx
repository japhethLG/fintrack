"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import type { IBaseModalProps } from "./BaseModal";
import { BaseModal } from "./BaseModal";
import type { IModalData, TModalName } from "./utils";
import { MODALS } from "./utils";

// ============================================================================
// CONTEXT
// ============================================================================

type TModalContextType = {
  openModal: (modalName: TModalName, modalData?: any, modalTitle?: string) => void;
  closeModal: (modalName: TModalName) => void;
  closeAllModals: () => void;
  hideModal: (modalName: TModalName) => void;
  showModal: (modalName: TModalName) => void;
};

const ModalContext = createContext<TModalContextType | undefined>(undefined);

// ============================================================================
// HOOK
// ============================================================================

export const useModal = () => {
  const context = useContext(ModalContext);

  if (!context) {
    // During HMR/hot reload, context might temporarily be undefined
    if (process.env.NODE_ENV === "production") {
      throw new Error("useModal must be used within a ModalProvider");
    }
    // Return a no-op implementation during hot reload
    console.warn("useModal called outside ModalProvider during hot reload");

    return {
      openModal: () => {},
      closeModal: () => {},
      closeAllModals: () => {},
      hideModal: () => {},
      showModal: () => {},
    } as TModalContextType;
  }

  return context;
};

// ============================================================================
// PROVIDER
// ============================================================================

interface IModalProviderProps {
  children: React.ReactNode;
}

export function ModalProvider(props: IModalProviderProps): React.ReactElement {
  const [modalState, setModalState] = useState(MODALS);

  const modals = Object.keys(MODALS).filter(
    (modalName) => modalState[modalName as keyof typeof MODALS].isOpen
  );

  const openModal = useCallback(
    (modalName: TModalName, modalData: IBaseModalProps["modalData"] = undefined, modalTitle?: string) => {
      setModalState((prevState) => ({
        ...prevState,
        [modalName]: {
          ...prevState[modalName],
          isOpen: true,
          title: modalTitle || prevState[modalName].title,
          modalData,
        },
      }));
    },
    []
  );

  const closeModal = useCallback((modalName: TModalName) => {
    setModalState((prevState) => {
      const modal = prevState[modalName as keyof typeof MODALS];

      const onCloseModal = (modal?.modalData as { onCloseModal?: () => void } | undefined)
        ?.onCloseModal;

      onCloseModal?.();

      return {
        ...prevState,
        [modalName]: {
          ...modal,
          isOpen: false,
        },
      };
    });
  }, []);

  const closeAllModals = useCallback((): void => {
    setModalState((prevState) => {
      Object.keys(prevState).forEach((modalName) => {
        const modal = prevState[modalName as keyof typeof MODALS];

        if (modal.isOpen) {
          const onCloseModal = (modal?.modalData as { onCloseModal?: () => void } | undefined)
            ?.onCloseModal;

          onCloseModal?.();
        }
      });

      return { ...MODALS };
    });
  }, []);

  const hideModal = useCallback((modalName: TModalName) => {
    setModalState((prevState) => ({
      ...prevState,
      [modalName]: {
        ...prevState[modalName],
        isHidden: true,
      },
    }));
  }, []);

  const showModal = useCallback((modalName: TModalName) => {
    setModalState((prevState) => ({
      ...prevState,
      [modalName]: {
        ...prevState[modalName],
        isHidden: false,
      },
    }));
  }, []);

  return (
    <ModalContext.Provider value={{ openModal, closeModal, closeAllModals, hideModal, showModal }}>
      {modals.map((modalName) => {
        const modal = modalState[modalName as keyof typeof MODALS];

        if (modal.isHidden) {
          return null;
        }

        return (
          <BaseModal
            key={modalName}
            modalName={modalName}
            isOpen={modal.isOpen}
            title={modal.title}
            modalData={modal.modalData as IModalData[keyof IModalData]}
            closeModal={() => {
              closeModal(modalName as TModalName);
            }}
            width={modal.width}
            closable={modal.closable}
            className={modal.className}
            centered={modal.centered}
            data-testid={modalName.replace(/([A-Z])/g, "-$1").toLowerCase().slice(1)}
          />
        );
      })}
      {props.children}
    </ModalContext.Provider>
  );
}

export { useModal as default };
