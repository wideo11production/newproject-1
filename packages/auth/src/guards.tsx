"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "./store";

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  requiredRoles?: string[];
  redirectTo?: string;
}

export function AuthGuard({
  children,
  fallback = null,
  requiredRoles,
  redirectTo = "/auth/login",
}: AuthGuardProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, hasRole } = useAuthStore();

  if (isLoading) {
    return <>{fallback}</>;
  }

  if (!isAuthenticated) {
    router.push(redirectTo);
    return <>{fallback}</>;
  }

  if (requiredRoles && requiredRoles.length > 0 && user && !hasRole(requiredRoles)) {
    router.push("/403");
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface GuestGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
  redirectTo?: string;
}

export function GuestGuard({
  children,
  fallback = null,
  redirectTo = "/",
}: GuestGuardProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <>{fallback}</>;
  }

  if (isAuthenticated) {
    router.push(redirectTo);
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export function RoleGuard({
  children,
  roles,
  fallback = null,
}: {
  children: ReactNode;
  roles: string[];
  fallback?: ReactNode;
}) {
  const { user, hasRole, isLoading } = useAuthStore();

  if (isLoading) {
    return <>{fallback}</>;
  }

  if (!user || !hasRole(roles)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}