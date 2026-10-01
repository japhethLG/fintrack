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

  // The latest onClose, read at event time: the parent passes a new function every render, and
  // re-subscribing on each render left windows with no Escape listener (a keypress right after the
  // menu opened was lost, which made "Escape closes it" flaky).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };

    // Escape has no "opening event" to ignore: listen at once. Only the outside click is
    // deferred a tick so the right-click that opened the menu does not close it.
    document.addEventListener("keydown", handleEscape);
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

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
