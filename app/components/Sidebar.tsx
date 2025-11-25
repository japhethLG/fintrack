"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const menuItems = [
    { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "calendar", path: "/calendar", label: "Financial Calendar", icon: "calendar_month" },
    { id: "income", path: "/income", label: "Income Manager", icon: "account_balance_wallet" },
    { id: "forecast", path: "/forecast", label: "AI Forecast", icon: "smart_toy" },
    { id: "transactions", path: "/transactions", label: "Transactions", icon: "receipt_long" },
  ];

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const isActive = (path: string) => {
    return pathname === path;
  };

  return (
    <aside className="w-20 lg:w-64 bg-[#151c2c] border-r border-gray-800 flex flex-col transition-all duration-300 shrink-0">
      <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-gray-800 gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shrink-0">
          <Icon name="account_balance" className="text-white" />
        </div>
        <span className="text-white font-bold text-xl hidden lg:block">FinTrack</span>
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
          >
            <span className="font-medium hidden lg:block">{item.label}</span>
            {/* {isActive(item.path) && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white hidden lg:block"></div>
            )} */}
          </Button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-800 cursor-pointer transition-colors mb-2">
          <Image
            src={user?.photoURL || "https://picsum.photos/40/40"}
            alt="User"
            width={40}
            height={40}
            className="w-10 h-10 rounded-full border-2 border-gray-700"
            unoptimized
          />
          <div className="hidden lg:block overflow-hidden flex-1">
            <p className="text-sm font-bold text-white truncate">{user?.displayName || "User"}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email || ""}</p>
          </div>
        </div>
        <Button
          onClick={handleLogout}
          variant="ghost"
          fullWidth
          className="flex items-center gap-3 p-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-danger transition-colors"
          icon={<Icon name="logout" size="sm" />}
          iconPosition="left"
        >
          <span className="font-medium hidden lg:block">Logout</span>
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
