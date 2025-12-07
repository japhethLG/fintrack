"use client";

import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

interface IProps {
  transaction: Transaction;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const DraggableDayChip: React.FC<IProps> = ({ transaction, children, className, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${transaction.id}-day-chip`,
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
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-0 pointer-events-none",
        className
      )}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </div>
  );
};

export default DraggableDayChip;

