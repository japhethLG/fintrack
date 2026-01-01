"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { Button, Icon, UserAvatar } from "@/components/common";
import {
  Drawer,
  DrawerRoot,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/common/Drawer";
import { cn } from "@/lib/utils/cn";
import { getAssetPath } from "@/lib/utils/assetPath";

const MENU_ITEMS = [
  { id: "dashboard", path: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "calendar", path: "/calendar", label: "Financial Calendar", icon: "calendar_month" },
  { id: "income", path: "/income", label: "Income Manager", icon: "account_balance_wallet" },
  { id: "expenses", path: "/expenses", label: "Expense Manager", icon: "payments" },
  { id: "transactions", path: "/transactions", label: "Transactions", icon: "receipt_long" },
  { id: "forecast", path: "/forecast", label: "AI Forecast", icon: "smart_toy" },
  { id: "settings", path: "/settings", label: "Settings", icon: "settings" },
];

const MobileNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, userProfile, logout } = useAuth();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const handleNavigation = (path: string) => {
    router.push(path);
    setIsDrawerOpen(false);
  };

  const isActive = (path: string) => pathname === path;

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-[#151c2c] border-b border-gray-800">
      <div className="flex items-center justify-between h-16 px-4">
        {/* Hamburger Menu Button */}
        <DrawerRoot open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="menu" size="md" />}
              className="text-gray-400 hover:text-white"
              aria-label="Open menu"
            />
          </DrawerTrigger>

          <DrawerContent side="left" showClose={false} className="w-[280px] p-0">
            {/* Drawer Header */}
            <DrawerHeader className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between">
                <Link href="/" className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-primary/20">
                    <Image
                      src={getAssetPath("/logo.png")}
                      alt="FinTrack"
                      width={40}
                      height={40}
                      className="object-cover"
                    />
                  </div>
                  <DrawerTitle className="text-xl font-bold text-white">FinTrack</DrawerTitle>
                </Link>
                <DrawerClose asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="close" size="sm" />}
                    className="text-gray-400 hover:text-white"
                  />
                </DrawerClose>
              </div>
            </DrawerHeader>

            {/* Navigation Items */}
            <nav className="flex-1 py-4 px-3 overflow-y-auto">
              <div className="space-y-1">
                {MENU_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleNavigation(item.path)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
                      isActive(item.path)
                        ? "bg-primary text-white shadow-lg shadow-primary/20"
                        : "text-gray-400 hover:bg-gray-800 hover:text-white"
                    )}
                  >
                    <Icon name={item.icon} size="md" />
                    <span className="font-medium">{item.label}</span>
                  </button>
                ))}
              </div>
            </nav>

            {/* User Section */}
            <div className="border-t border-gray-800 p-4">
              <button
                onClick={() => handleNavigation("/settings")}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-800 transition-colors"
              >
                <UserAvatar
                  imageUrl={userProfile?.profilePictureUrl}
                  name={userProfile?.displayName || user?.displayName}
                  email={user?.email}
                  size="md"
                  className="border-2 border-gray-700"
                />
                <div className="flex-1 text-left overflow-hidden">
                  <p className="text-sm font-bold text-white truncate">
                    {userProfile?.displayName || user?.displayName || "User"}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{user?.email || ""}</p>
                </div>
              </button>

              <Button
                onClick={handleLogout}
                variant="ghost"
                fullWidth
                className="mt-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-danger"
                icon={<Icon name="logout" size="sm" />}
                iconPosition="left"
              >
                Logout
              </Button>
            </div>
          </DrawerContent>
        </DrawerRoot>

        {/* Center Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden shadow-lg shadow-primary/20">
            <Image
              src={getAssetPath("/logo.png")}
              alt="FinTrack"
              width={32}
              height={32}
              className="object-cover"
            />
          </div>
          <span className="text-white font-bold text-lg">FinTrack</span>
        </Link>

        {/* Right Side - User Avatar */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/settings")}
          className="p-1"
          aria-label="Settings"
        >
          <UserAvatar
            imageUrl={userProfile?.profilePictureUrl}
            name={userProfile?.displayName || user?.displayName}
            email={user?.email}
            size="sm"
            className="border-2 border-gray-700"
          />
        </Button>
      </div>
    </header>
  );
};

export default MobileNav;
