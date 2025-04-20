"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/firebase.config";

interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: "admin" | "captain" | "participant" | null;
  currentEventId?: string | null;
  teamId?: string | null;
}

interface AuthContextProps {
  currentUser: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextProps>({
  currentUser: null,
  loading: true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        // User is signed in, fetch profile data from Firestore
        const userDocRef = doc(db, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          setCurrentUser({
            uid: user.uid,
            email: user.email,
            displayName: userData.displayName || user.displayName, // Prioritize Firestore display name
            role: userData.role || "participant", // Default to participant if not set
            currentEventId: userData.currentEventId || null,
            teamId: userData.teamId || null,
          });
        } else {
          // Handle case where auth user exists but no Firestore doc (e.g., during signup flow)
          // Or create a basic profile if needed immediately. For now, just set basic info.
          console.warn(
            "User document not found in Firestore for UID:",
            user.uid
          );
          setCurrentUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            role: "participant", // Default assumption
          });
        }
      } else {
        // User is signed out
        setCurrentUser(null);
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, loading }}>
      {!loading && children} {/* Render children only when loading is false */}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
