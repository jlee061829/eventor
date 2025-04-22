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
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-200 to-gray-400">
        <div className="text-center">
          <div className="loader mb-4"></div>
          <p className="text-lg font-medium text-gray-700">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 text-white">
        <h1 className="text-5xl font-extrabold mb-6 text-center">
          Welcome to <span className="italic">Eventor</span>
        </h1>
        <p className="text-lg mb-8 text-center max-w-md">
          Get hyped for KTPalooza!
        </p>
        <p className="text-lg mb-8 text-center max-w-md">
          Log in or sign up to get started.
        </p>
        <div className="flex space-x-4">
          <Link
            href="/login"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition duration-200 shadow-lg"
          >
            Log In
          </Link>
          <Link
            href="/signup"
            className="px-8 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition duration-200 shadow-lg"
          >
            Sign Up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-200 to-gray-400">
      <p className="text-lg font-medium text-gray-700">Redirecting...</p>
    </div>
  );
}
