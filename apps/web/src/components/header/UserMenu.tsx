"use client"

import { useState } from "react";
import { LogOut, User, Settings, ChevronDown } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

export default function UserMenu() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (!session?.user) {
    return (
      <div className="flex items-center space-x-2">
        <a href="/auth/signin" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          Sign In
        </a>
        <a href="/auth/signup" className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors">
          Sign Up
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
          {session.user.name?.[0]?.toUpperCase() || session.user.email?.[0]?.toUpperCase() || "U"}
        </div>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-900 rounded-lg shadow-lg border border-gray-800 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-800">
            <p className="text-sm font-medium text-ink truncate">{session.user.name || "User"}</p>
            <p className="text-xs text-gray-400 truncate">{session.user.email}</p>
          </div>
          <a href="/dashboard" className="flex items-center space-x-2 px-4 py-2 text-gray-300 hover:bg-gray-800 hover:text-ink">
            <User className="w-4 h-4" />
            <span>Dashboard</span>
          </a>
          <a href="/settings" className="flex items-center space-x-2 px-4 py-2 text-gray-300 hover:bg-gray-800 hover:text-ink">
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </a>
          <hr className="border-gray-800 my-1" />
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="flex items-center space-x-2 w-full px-4 py-2 text-red-400 hover:bg-gray-800 hover:text-red-300"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
