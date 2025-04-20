// src/app/(protected)/dashboard/page.tsx
"use client";

import React, { useState, useEffect } from "react"; // Import useState, useEffect
import Link from "next/link"; // Import Link
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config"; // Import db
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from "firebase/firestore"; // Import Firestore functions

// Define an interface for the events fetched for the admin
interface AdminEvent {
  id: string;
  name: string;
  status: string;
  createdAt: Timestamp; // Or Date, depending on how you retrieve it
}

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([]); // State for admin's events
  const [loadingEvents, setLoadingEvents] = useState(false); // Loading state for events

  // Fetch events if the user is an admin
  useEffect(() => {
    if (currentUser?.role === "admin") {
      setLoadingEvents(true);
      const fetchAdminEvents = async () => {
        try {
          const eventsCollectionRef = collection(db, "events");
          // Query events where the adminId matches the current user's UID
          const q = query(
            eventsCollectionRef,
            where("adminId", "==", currentUser.uid)
          );
          const querySnapshot = await getDocs(q);
          const fetchedEvents = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as AdminEvent[]; // Adjust fields based on your EventData interface if needed

          // Sort events, e.g., by creation date descending
          fetchedEvents.sort(
            (a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()
          );

          setAdminEvents(fetchedEvents);
        } catch (error) {
          console.error("Error fetching admin events:", error);
          // Handle error display if needed
        } finally {
          setLoadingEvents(false);
        }
      };
      fetchAdminEvents();
    } else {
      // Clear events if user is not admin or logs out/changes role
      setAdminEvents([]);
    }
  }, [currentUser]); // Rerun when currentUser changes

  if (!currentUser) {
    return <div>Loading...</div>;
  }

  // --- Admin Content ---
  const renderAdminContent = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">Admin Dashboard</h2>
      <div className="mb-6">
        {/* Replace placeholder with actual Link */}
        <Link
          href="/admin/create-event"
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded inline-block"
        >
          Create New Event
        </Link>
      </div>

      <h3 className="text-lg font-medium mb-3">Your Events</h3>
      {loadingEvents ? (
        <p>Loading your events...</p>
      ) : adminEvents.length > 0 ? (
        <ul className="space-y-3">
          {adminEvents.map((event) => (
            <li
              key={event.id}
              className="p-4 bg-white rounded shadow border flex justify-between items-center"
            >
              <div>
                <span className="font-semibold">{event.name}</span>
                <span
                  className={`ml-3 text-sm px-2 py-0.5 rounded ${
                    event.status === "drafting"
                      ? "bg-yellow-200 text-yellow-800"
                      : event.status === "active"
                      ? "bg-green-200 text-green-800"
                      : event.status === "completed"
                      ? "bg-gray-200 text-gray-800"
                      : "bg-blue-200 text-blue-800" // Default/setup/inviting etc.
                  }`}
                >
                  {event.status}
                </span>
              </div>
              <Link
                href={`/event/${event.id}/manage`}
                className="text-sm text-indigo-600 hover:underline font-medium"
              >
                Manage Event →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500 italic">
          You haven't created any events yet.
        </p>
      )}
    </div>
  );

  // --- Captain Content (Example - Needs implementation) ---
  const renderCaptainContent = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">Captain Dashboard</h2>
      {/* TODO: Fetch and display current event info */}
      {currentUser.currentEventId ? (
        <div>
          <p>You are a captain in event: {currentUser.currentEventId}</p>{" "}
          {/* TODO: Fetch event name */}
          {/* TODO: Link to team management */}
          {/* TODO: Link to current event draft page if status is 'drafting' */}
          <Link
            href={`/event/${currentUser.currentEventId}/draft`}
            className="text-blue-600 hover:underline"
          >
            Go to Draft
          </Link>{" "}
          <br />
          {/* TODO: Link to current event leaderboard */}
          <Link
            href={`/event/${currentUser.currentEventId}/leaderboard`}
            className="text-blue-600 hover:underline"
          >
            View Leaderboard
          </Link>
          <br />
          {/* TODO: Link to relevant sub-event assignment pages */}
        </div>
      ) : (
        <p>You are not currently assigned to an event as a captain.</p>
      )}
    </div>
  );

  // --- Participant Content (Example - Needs implementation) ---
  const renderParticipantContent = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">Participant Dashboard</h2>
      {currentUser.currentEventId ? (
        <div>
          <p>You are participating in event: {currentUser.currentEventId}</p>{" "}
          {/* TODO: Fetch event name */}
          <p>Your Team ID: {currentUser.teamId || "Not Assigned Yet"}</p>{" "}
          {/* TODO: Fetch team name */}
          {/* TODO: Link to current event leaderboard */}
          <Link
            href={`/event/${currentUser.currentEventId}/leaderboard`}
            className="text-blue-600 hover:underline"
          >
            View Leaderboard
          </Link>
          <br />
          {/* TODO: Link to view upcoming sub-events */}
        </div>
      ) : (
        <p className="text-gray-500 italic">
          You have no active event. Check{" "}
          <Link href="/invitations" className="text-blue-600 hover:underline">
            invitations
          </Link>
          .
        </p>
      )}
    </div>
  );

  // --- Main Dashboard Render ---
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <p className="mb-4">
        Welcome back, {currentUser.displayName || currentUser.email}!
      </p>

      {/* Display content based on user role */}
      {currentUser.role === "admin" && renderAdminContent()}
      {currentUser.role === "captain" && renderCaptainContent()}
      {currentUser.role === "participant" && renderParticipantContent()}
    </div>
  );
}
