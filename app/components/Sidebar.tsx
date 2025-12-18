"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon, Tooltip } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { getAssetPath } from "@/lib/utils/assetPath";

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, userProfile, logout } = useAuth();

  // Initialize state from localStorage, default to false
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return saved === "true";
    }
    return false;
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
    }
  }, [isCollapsed]);

  const menuItems = [
    { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "calendar", path: "/calendar", label: "Financial Calendar", icon: "calendar_month" },
    { id: "income", path: "/income", label: "Income Manager", icon: "account_balance_wallet" },
    { id: "expenses", path: "/expenses", label: "Expense Manager", icon: "payments" },
    { id: "transactions", path: "/transactions", label: "Transactions", icon: "receipt_long" },
    { id: "forecast", path: "/forecast", label: "AI Forecast", icon: "smart_toy" },
    { id: "settings", path: "/settings", label: "Settings", icon: "settings" },
  ];

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <aside
      className={cn(
        "bg-[#151c2c] border-r border-gray-800 flex flex-col transition-all duration-300 shrink-0",
        isCollapsed ? "w-20" : "w-20 lg:w-64"
      )}
    >
      <div
        className={cn(
          "h-20 flex items-center border-b border-gray-800 gap-3 transition-all duration-300 relative",
          isCollapsed ? "justify-center px-0" : "justify-center lg:justify-start lg:px-6"
        )}
      >
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-shadow">
            <Image
              src={getAssetPath("/logo.png")}
              alt="FinTrack"
              width={40}
              height={40}
              className="object-cover"
            />
          </div>
          <span
            className={cn(
              "text-white font-bold text-xl transition-opacity duration-300 group-hover:text-primary",
              isCollapsed ? "hidden" : "hidden lg:block"
            )}
          >
            FinTrack
          </span>
        </Link>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 z-10 bg-[#151c2c] border border-gray-800 shadow-lg hidden lg:flex"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon
            name={isCollapsed ? "chevron_right" : "chevron_left"}
            size="xs"
            className="text-current"
          />
        </button>
      </div>

      <nav className="flex-1 py-6 flex flex-col gap-2 px-2 lg:px-4">
        {menuItems.map((item) => (
          <Button
            key={item.id}
            onClick={() => router.push(item.path)}
            variant={isActive(item.path) ? "primary" : "ghost"}
            className={cn(
              "flex items-center justify-start gap-3 p-3 rounded-xl group",
              isActive(item.path)
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-gray-400 hover:bg-gray-800 hover:text-white"
            )}
            icon={<Icon name={item.icon} size="md" />}
            iconPosition="left"
            tooltip={isCollapsed ? item.label : undefined}
            tooltipPosition="right"
          >
            <span
              className={cn(
                "font-medium transition-opacity duration-300",
                isCollapsed ? "hidden" : "hidden lg:block"
              )}
            >
              {item.label}
            </span>
            {/* {isActive(item.path) && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white hidden lg:block"></div>
            )} */}
          </Button>
        ))}
      </nav>

      <div
        className={cn(
          "border-t border-gray-800 transition-all duration-300",
          isCollapsed ? "p-2" : "p-4"
        )}
      >
        <Tooltip
          content={
            isCollapsed ? (
              <div className="text-center">
                <div className="font-semibold">
                  {userProfile?.displayName || user?.displayName || "User"}
                </div>
                <div className="text-xs text-gray-300 mt-0.5">{user?.email || ""}</div>
              </div>
            ) : undefined
          }
          position="right"
        >
          <div
            className={cn(
              "rounded-xl hover:bg-gray-800 cursor-pointer transition-all duration-300",
              isCollapsed
                ? "flex items-center justify-center p-2"
                : "flex items-center gap-3 p-2 mb-2"
            )}
            onClick={() => router.push("/settings")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && router.push("/settings")}
          >
            <Image
              src={user?.photoURL || "https://picsum.photos/40/40"}
              alt="User"
              width={40}
              height={40}
              className="w-10 h-10 rounded-full border-2 border-gray-700 shrink-0"
              unoptimized
            />
            <div
              className={cn(
                "overflow-hidden transition-opacity duration-300",
                isCollapsed ? "hidden" : "hidden lg:block flex-1"
              )}
            >
              <p className="text-sm font-bold text-white truncate">
                {userProfile?.displayName || user?.displayName || "User"}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email || ""}</p>
            </div>
          </div>
        </Tooltip>
        <Button
          onClick={handleLogout}
          variant="ghost"
          fullWidth
          className={cn(
            "rounded-xl text-gray-400 hover:bg-gray-800 hover:text-danger transition-colors",
            isCollapsed ? "flex items-center justify-center p-2" : "flex items-center gap-3 p-2"
          )}
          icon={<Icon name="logout" size="sm" />}
          iconPosition="left"
          tooltip={isCollapsed ? "Logout" : undefined}
          tooltipPosition="right"
        >
          <span
            className={cn(
              "font-medium transition-opacity duration-300",
              isCollapsed ? "hidden" : "hidden lg:block"
            )}
          >
            Logout
          </span>
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
