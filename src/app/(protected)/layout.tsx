// src/app/(protected)/layout.tsx
"use client";

import React, { ReactNode, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { auth } from "@/firebase.config"; // Import auth
import { signOut } from "firebase/auth"; // Import signOut

// Basic Navbar component (can be moved to components later)
const Navbar = () => {
  const { currentUser } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/login"); // Redirect to login after logout
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  return (
    <nav className="bg-blue-600 text-white p-4 shadow-md">
      <div className="container mx-auto flex justify-between items-center">
        <span className="font-bold text-xl">Eventor
        </span>
        <div>
          {currentUser && (
            <>
              <span className="mr-4">
                Welcome, {currentUser.displayName || currentUser.email}! (
                {currentUser.role})
              </span>
              {/* Add other nav links here maybe based on role */}
              <a href="/dashboard" className="mr-4 hover:underline">
                Dashboard
              </a>
              <a href="/invitations" className="mr-4 hover:underline">
                Invitations
              </a>
              {/* Add more links as needed */}
              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
              >
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !currentUser) {
      // Redirect to login page if not authenticated
      router.push("/login");
    }
  }, [currentUser, loading, router]);

  if (loading) {
    return <div>Loading user...</div>; // Or a full-page loader
  }

  if (!currentUser) {
    // Although useEffect redirects, this prevents rendering children briefly before redirect
    return null; // Or a loading indicator/message
  }

  // Render the navbar and the protected page content
  return (
    <div className="bg-gradient-to-br from-green-400 to-blue-500">
      <Navbar />
      <main className="container mx-auto p-4 bg-gradient-to-br from-green-400 to-blue-500">{children}</main>
    </div>
  );
}
