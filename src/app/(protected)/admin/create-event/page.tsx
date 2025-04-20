// src/app/(protected)/admin/create-event/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function CreateEventPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [numberOfTeams, setNumberOfTeams] = useState<number>(2); // Default to 2 teams
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") {
      console.warn("Access denied: User is not an admin.");
      router.push("/dashboard"); // Or an unauthorized page
    }
  }, [currentUser, router]);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentUser || currentUser.role !== "admin") {
      setError("Permission denied. Only admins can create events.");
      return;
    }
    if (!eventName.trim()) {
      setError("Event name cannot be empty.");
      return;
    }
    if (numberOfTeams < 2) {
      setError("Number of teams must be at least 2.");
      return;
    }

    setLoading(true);

    try {
      const eventsCollectionRef = collection(db, "events");
      const newEventDoc = await addDoc(eventsCollectionRef, {
        name: eventName.trim(),
        adminId: currentUser.uid,
        status: "setup", // Initial status
        numberOfTeams: numberOfTeams,
        participantEmails: [], // Initialize as empty array
        participantIds: [], // Initialize as empty array
        availableForDraftIds: [], // Initialize as empty array
        createdAt: serverTimestamp(),
        // Add other relevant fields based on your model maybe later
      });

      console.log("Event created with ID: ", newEventDoc.id);
      // Redirect to the manage page for the newly created event
      router.push(`/event/${newEventDoc.id}/manage`);
    } catch (err: any) {
      console.error("Error creating event:", err);
      setError(
        "Failed to create event. Please try again. Error: " + err.message
      );
      setLoading(false);
    }
    // No need to setLoading(false) on success due to redirect
  };

  // Render loading or null if role check is pending or user is not admin
  if (!currentUser || currentUser.role !== "admin") {
    return <div>Loading or checking permissions...</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create New Event</h1>
      <form
        onSubmit={handleCreateEvent}
        className="max-w-lg bg-white p-6 rounded shadow-md"
      >
        <div className="mb-4">
          <label
            htmlFor="eventName"
            className="block text-gray-700 font-semibold mb-2"
          >
            Event Name:
          </label>
          <input
            type="text"
            id="eventName"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            required
            className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
          />
        </div>
        <div className="mb-6">
          <label
            htmlFor="numberOfTeams"
            className="block text-gray-700 font-semibold mb-2"
          >
            Number of Teams:
          </label>
          <input
            type="number"
            id="numberOfTeams"
            value={numberOfTeams}
            onChange={(e) => setNumberOfTeams(parseInt(e.target.value, 10))}
            min="2"
            required
            className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
          />
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2 px-4 rounded text-white font-semibold ${
            loading
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          {loading ? "Creating..." : "Create Event"}
        </button>
      </form>
    </div>
  );
}
