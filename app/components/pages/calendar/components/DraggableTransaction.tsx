"use client";

import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

interface IProps {
  transaction: Transaction;
  className?: string;
  children: React.ReactNode;
}

const DraggableTransaction: React.FC<IProps> = ({ transaction, className, children }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: transaction.id,
    data: { transaction },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-50", className)}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
};

export default DraggableTransaction;
