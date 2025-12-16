"use client";

import React from "react";
import { LoadingSpinner } from "@/components/common";
import { componentMap } from "./utils";

interface IProps {
  fileName: string;
  modalData?: any;
  closeModal: () => void;
}

const LazyModalComponent: React.FC<IProps> = ({ fileName, modalData, closeModal }) => {
  const Component = React.lazy(componentMap[fileName as keyof typeof componentMap]);

  return (
    <React.Suspense
      fallback={
        <div className="flex h-16 items-center justify-center">
          <LoadingSpinner size="md" />
        </div>
      }
    >
      {fileName ? <Component modalData={modalData} closeModal={closeModal} /> : null}
    </React.Suspense>
  );
};

export default LazyModalComponent;
