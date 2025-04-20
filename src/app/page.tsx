// src/app/page.tsx
"use client";

import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const { currentUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect logged-in users to dashboard
    if (!loading && currentUser) {
      router.push("/dashboard");
    }
  }, [currentUser, loading, router]);

  if (loading) {
    return <div>Loading...</div>; // Or a proper loading spinner
  }

  // Only show login/signup if not loading and no user
  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
        <h1 className="text-4xl font-bold mb-8">
          Welcome to KTP Event Manager
        </h1>
        <div className="space-x-4">
          <Link
            href="/login"
            className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Log In
          </Link>
          <Link
            href="/signup"
            className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Sign Up
          </Link>
        </div>
      </div>
    );
  }

  // If user is logged in but redirect hasn't happened yet (or failsafe)
  return <div>Redirecting...</div>;
}
