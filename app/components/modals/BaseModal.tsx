"use client";

import React, { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils/cn";
import { Button, Icon } from "@/components/common";
import LazyModalComponent from "./LazyModalComponent";
import { widthValues, type TModalWidth, type IModalData } from "./utils";

export interface IBaseModalProps {
  modalName: string;
  isOpen?: boolean;
  modalData?: IModalData[keyof IModalData];
  title?: React.ReactNode | string;
  closeModal: () => void;
  width?: TModalWidth;
  closable?: boolean;
  className?: string;
  centered?: boolean;
  "data-testid"?: string;
}

export const BaseModal = memo((props: IBaseModalProps) => {
  const {
    isOpen,
    modalData,
    modalName,
    closeModal,
    title,
    width = "md",
    closable = true,
    className,
    centered = true,
    "data-testid": dataTestId,
  } = props;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && closeModal()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-50 w-full p-4",
            centered
              ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              : "top-4 left-1/2 -translate-x-1/2",
            widthValues[width],
            className
          )}
          data-testid={dataTestId}
        >
          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
            {/* Header */}
            {(title || closable) && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                {title && (
                  <Dialog.Title className="text-lg font-bold text-white">
                    {title}
                  </Dialog.Title>
                )}
                {closable && (
                  <Dialog.Close asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Icon name="close" size="sm" />}
                      onClick={closeModal}
                      className="ml-auto"
                    />
                  </Dialog.Close>
                )}
              </div>
            )}

            {/* Content */}
            <div className="p-6">
              <LazyModalComponent
                fileName={modalName}
                closeModal={closeModal}
                modalData={modalData}
              />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

BaseModal.displayName = "BaseModal";
