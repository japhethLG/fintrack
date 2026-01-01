"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { Icon } from "./Icon";

// ============================================================================
// INTERFACES
// ============================================================================

export interface ContextMenuItem {
  /** Unique identifier for the menu item */
  id: string;
  /** Display label */
  label: string;
  /** Material icon name */
  icon?: string;
  /** Click handler */
  onClick: () => void;
  /** Visual variant */
  variant?: "default" | "danger" | "success";
  /** Divider after this item */
  divider?: boolean;
}

export interface ContextMenuProps {
  /** Menu items to display */
  items: ContextMenuItem[];
  /** Position of the menu */
  position: { x: number; y: number };
  /** Callback when menu should close */
  onClose: () => void;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ContextMenu: React.FC<ContextMenuProps> = ({
  items,
  position,
  onClose,
  className = "",
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    // Add listeners with a slight delay to prevent immediate close
    setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let { x, y } = position;

    // Adjust horizontal position
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10;
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  const variantStyles = {
    default: "text-white hover:bg-gray-700",
    danger: "text-danger hover:bg-danger/10",
    success: "text-success hover:bg-success/10",
  };

  const handleItemClick = (item: ContextMenuItem) => {
    item.onClick();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[9999] min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl",
        "animate-fade-in",
        className
      )}
      style={{ left: position.x, top: position.y }}
    >
      <div className="py-1">
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            <button
              onClick={() => handleItemClick(item)}
              className={cn(
                "w-full px-4 py-2 text-left text-sm font-medium transition-colors duration-150",
                "flex items-center gap-3",
                variantStyles[item.variant || "default"]
              )}
            >
              {item.icon && <Icon name={item.icon} size="sm" />}
              <span>{item.label}</span>
            </button>
            {item.divider && index < items.length - 1 && (
              <div className="my-1 border-t border-gray-700" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default ContextMenu;
