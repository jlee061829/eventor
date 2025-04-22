// src/app/(protected)/dashboard/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from "firebase/firestore";

interface AdminEvent {
  id: string;
  name: string;
  status: string;
  createdAt: Timestamp;
}

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (currentUser?.role === "admin") {
      setLoadingEvents(true);
      const fetchAdminEvents = async () => {
        try {
          const eventsCollectionRef = collection(db, "events");
          const q = query(
            eventsCollectionRef,
            where("adminId", "==", currentUser.uid)
          );
          const querySnapshot = await getDocs(q);
          const fetchedEvents = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as AdminEvent[];

          fetchedEvents.sort(
            (a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()
          );

          setAdminEvents(fetchedEvents);
        } catch (error) {
          console.error("Error fetching admin events:", error);
        } finally {
          setLoadingEvents(false);
        }
      };
      fetchAdminEvents();
    } else {
      setAdminEvents([]);
    }
  }, [currentUser]);

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-100 to-gray-300">
        <p className="text-lg font-medium text-gray-700">Loading...</p>
      </div>
    );
  }

  const renderAdminContent = () => (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Admin Dashboard</h2>
      <div className="mb-6">
        <Link
          href="/admin/create-event"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg shadow-md transition duration-200"
        >
          Create New Event
        </Link>
      </div>

      <h3 className="text-lg font-medium mb-3 text-gray-700">Your Events</h3>
      {loadingEvents ? (
        <p className="text-gray-500">Loading your events...</p>
      ) : adminEvents.length > 0 ? (
        <ul className="space-y-4">
          {adminEvents.map((event) => (
            <li
              key={event.id}
              className="p-4 bg-gray-50 rounded-lg shadow border flex justify-between items-center"
            >
              <div>
                <span className="font-semibold text-gray-800">{event.name}</span>
                <span
                  className={`ml-3 text-sm px-2 py-0.5 rounded ${
                    event.status === "drafting"
                      ? "bg-yellow-100 text-yellow-800"
                      : event.status === "active"
                      ? "bg-green-100 text-green-800"
                      : event.status === "completed"
                      ? "bg-gray-100 text-gray-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {event.status}
                </span>
              </div>
              <Link
                href={`/event/${event.id}/manage`}
                className="text-sm text-blue-600 hover:underline font-medium"
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

  const renderCaptainContent = () => (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Captain Dashboard</h2>
      {currentUser.currentEventId ? (
        <div>
          <p className="text-gray-700">
            You are a captain in event:{" "}
            <span className="font-medium">{currentUser.currentEventId}</span>
          </p>
          <div className="mt-4 space-y-2">
            <Link
              href={`/event/${currentUser.currentEventId}/draft`}
              className="text-blue-600 hover:underline"
            >
              Go to Draft
            </Link>
            <br />
            <Link
              href={`/event/${currentUser.currentEventId}/leaderboard`}
              className="text-blue-600 hover:underline"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 italic">
          You are not currently assigned to an event as a captain.
        </p>
      )}
    </div>
  );

  const renderParticipantContent = () => (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-2xl font-semibold mb-4 text-gray-800">Participant Dashboard</h2>
      {currentUser.currentEventId ? (
        <div>
          <p className="text-gray-700">
            You are participating in event:{" "}
            <span className="font-medium">{currentUser.currentEventId}</span>
          </p>
          <p className="text-gray-700">
            Your Team ID:{" "}
            <span className="font-medium">
              {currentUser.teamId || "Not Assigned Yet"}
            </span>
          </p>
          <div className="mt-4 space-y-2">
            <Link
              href={`/event/${currentUser.currentEventId}/leaderboard`}
              className="text-blue-600 hover:underline"
            >
              View Leaderboard
            </Link>
          </div>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center">
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6 text-center text-white">
          Welcome back,{" "}
          <span className="font-medium">
            {currentUser.displayName || currentUser.email}
          </span>
          !
        </h1>

        <div className="space-y-8">
          {currentUser.role === "admin" && renderAdminContent()}
          {currentUser.role === "captain" && renderCaptainContent()}
          {currentUser.role === "participant" && renderParticipantContent()}
        </div>
      </div>
    </div>
  );
}
