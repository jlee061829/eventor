// src/app/(protected)/event/[eventId]/manage/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link"; // Import Link
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  arrayUnion,
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp,
  runTransaction,
  documentId, // Import necessary functions
} from "firebase/firestore";

// Interface for user profiles (simplified for display)
interface ParticipantProfile {
  uid: string;
  displayName: string;
  role: string;
  teamId?: string | null;
}

// Interface for Team data
interface TeamData {
  id: string;
  name: string;
  captainId: string;
  memberIds: string[];
}

interface EventData {
  id: string;
  name: string;
  adminId: string;
  status: string; // 'setup', 'inviting', 'assigningCaptains', 'drafting', 'active', 'completed'
  numberOfTeams: number;
  participantEmails: string[];
  participantIds: string[];
  availableForDraftIds: string[];
  createdAt: Timestamp; // Add createdAt if needed
}

export default function ManageEventPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;

  const [subEventName, setSubEventName] = useState("");
  const [subEventLoading, setSubEventLoading] = useState(false);
  const [subEventError, setSubEventError] = useState<string | null>(null);
  const [subEvents, setSubEvents] = useState<{ id: string; name: string }[]>(
    []
  );
  const [eventData, setEventData] = useState<EventData | null>(null);
  const [participants, setParticipants] = useState<ParticipantProfile[]>([]);
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false); // For captain/draft actions

  // --- Fetch Event, Participants, and Teams ---
  const fetchEventDetails = useCallback(async () => {
    if (!eventId || !currentUser) return;
    setLoading(true);
    setError(null);
    setParticipants([]); // Reset participants on fetch
    setTeams([]); // Reset teams on fetch

    try {
      // Fetch Event Data
      const eventDocRef = doc(db, "events", eventId);
      const eventDocSnap = await getDoc(eventDocRef);

      if (!eventDocSnap.exists()) {
        throw new Error("Event not found.");
      }

      const fetchedEventData = {
        id: eventDocSnap.id,
        ...eventDocSnap.data(),
      } as EventData;

      if (fetchedEventData.adminId !== currentUser.uid) {
        throw new Error("Access Denied: You are not the admin of this event.");
      }
      setEventData(fetchedEventData);

      // Fetch Participants if there are any IDs
      if (
        fetchedEventData.participantIds &&
        fetchedEventData.participantIds.length > 0
      ) {
        const usersCollectionRef = collection(db, "users");
        // Firestore 'in' query limitation: max 30 IDs per query. Handle larger lists if necessary.
        if (fetchedEventData.participantIds.length > 30) {
          console.warn(
            "Fetching more than 30 participants, consider pagination or alternative approach."
          );
          // Implement chunking if needed
        }

        const usersQuery = query(
          usersCollectionRef,
          where(documentId(), "in", fetchedEventData.participantIds)
        );
        const usersSnapshot = await getDocs(usersQuery);
        const fetchedParticipants = usersSnapshot.docs.map((doc) => ({
          uid: doc.id,
          displayName: doc.data().displayName || "N/A",
          role: doc.data().role || "participant",
          teamId: doc.data().teamId || null,
        })) as ParticipantProfile[];
        setParticipants(fetchedParticipants);
      } else {
        setParticipants([]); // Explicitly set empty if no IDs
      }

      // Fetch Teams for this event
      const teamsCollectionRef = collection(db, "teams");
      const teamsQuery = query(
        teamsCollectionRef,
        where("eventId", "==", eventId)
      );
      const teamsSnapshot = await getDocs(teamsQuery);
      const fetchedTeams = teamsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as TeamData[];
      setTeams(fetchedTeams);
      const subEventsSnapshot = await getDocs(subEventsQuery);
      const fetchedSubEvents = subEventsSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "Unnamed Sub-Event",
      }));
      setSubEvents(fetchedSubEvents);
    } catch (err: any) {
      console.error("Error fetching event details:", err);
      setError("Failed to load event data. " + err.message);
      if (err.message.startsWith("Access Denied")) {
        router.push("/dashboard");
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, currentUser, router]);

  useEffect(() => {
    fetchEventDetails();
  }, [fetchEventDetails]);

  const subEventsQuery = query(
    collection(db, "subEvents"),
    where("eventId", "==", eventId)
  );

  // --- Invitation Logic (from Phase 3 - unchanged) ---
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !eventData || !currentUser) return;
    if (!/\S+@\S+\.\S+/.test(inviteEmail)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    setIsInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    const emailToInvite = inviteEmail.trim().toLowerCase();
    try {
      await addDoc(collection(db, "invites"), {
        eventId: eventData.id,
        recipientEmail: emailToInvite,
        status: "pending",
        sentBy: currentUser.uid,
        createdAt: serverTimestamp(),
        eventName: eventData.name,
      });
      await updateDoc(doc(db, "events", eventData.id), {
        participantEmails: arrayUnion(emailToInvite),
      });
      setInviteSuccess(`Invitation sent to ${emailToInvite}!`);
      setInviteEmail("");
      fetchEventDetails(); // Refetch to update lists if needed
    } catch (err: any) {
      console.error("Error sending invitation:", err);
      setInviteError("Failed to send invitation. " + err.message);
    } finally {
      setIsInviting(false);
    }
  };

  const handleCreateSubEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !eventData ||
      !subEventName.trim() ||
      currentUser?.uid !== eventData.adminId
    ) {
      setSubEventError("Invalid input or permission denied.");
      return;
    }
    setSubEventLoading(true);
    setSubEventError(null);

    try {
      const subEventsCollectionRef = collection(db, "subEvents");
      const newSubEvent = await addDoc(subEventsCollectionRef, {
        eventId: eventData.id,
        name: subEventName.trim(),
        // dateTime: Timestamp.fromDate(new Date()), // Example: Add date/time if needed
        // description: "", // Add description if needed
        assignedParticipants: {}, // Initialize empty map
        status: "upcoming", // Initial status
        createdAt: serverTimestamp(),
      });
      console.log("Sub-event created:", newSubEvent.id);
      setSubEventName(""); // Clear form
      // Refetch sub-events to update list
      fetchEventDetails(); // Or just update state directly: setSubEvents(prev => [...prev, { id: newSubEvent.id, name: subEventName.trim() }])
    } catch (err: any) {
      console.error("Error creating sub-event:", err);
      setSubEventError("Failed to create sub-event. " + err.message);
    } finally {
      setSubEventLoading(false);
    }
  };

  // --- Captain Assignment Logic ---
  const handleMakeCaptain = async (participant: ParticipantProfile) => {
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length >= eventData.numberOfTeams) {
      setError(
        `Cannot assign more captains. The maximum number of teams (${eventData.numberOfTeams}) has been reached.`
      );
      return;
    }
    if (participant.role !== "participant") {
      setError(`${participant.displayName} is already a ${participant.role}.`);
      return;
    }

    setActionLoading(true);
    setError(null);

    const batch = writeBatch(db);
    const userRef = doc(db, "users", participant.uid);
    const newTeamRef = doc(collection(db, "teams")); // Generate new team ID

    try {
      // 1. Create the new Team document
      batch.set(newTeamRef, {
        eventId: eventData.id,
        name: `Team ${teams.length + 1}`, // Simple naming convention
        captainId: participant.uid,
        memberIds: [participant.uid], // Captain is the first member
        createdAt: serverTimestamp(),
      });

      // 2. Update the User's role and assign teamId
      batch.update(userRef, {
        role: "captain",
        teamId: newTeamRef.id, // Assign the newly generated team ID
      });

      // Optional: Update event status if this is the first captain?
      // if (teams.length === 0) {
      //    const eventRef = doc(db, "events", eventData.id);
      //    batch.update(eventRef, { status: "assigningCaptains" });
      // }

      await batch.commit();
      console.log(
        `${participant.displayName} promoted to captain of Team ${
          teams.length + 1
        }`
      );
      // Refetch data to update UI
      fetchEventDetails();
    } catch (err: any) {
      console.error("Error making captain:", err);
      setError(
        `Failed to make ${participant.displayName} a captain. ${err.message}`
      );
    } finally {
      setActionLoading(false);
    }
  };

  // --- Draft Initiation Logic ---
  const handleStartDraft = async () => {
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length !== eventData.numberOfTeams) {
      setError(
        `Cannot start draft. Expected ${eventData.numberOfTeams} teams (captains assigned), but found ${teams.length}.`
      );
      return;
    }
    if (
      eventData.status === "drafting" ||
      eventData.status === "active" ||
      eventData.status === "completed"
    ) {
      setError(
        `Draft cannot be started. Event status is already '${eventData.status}'.`
      );
      return;
    }
    if (
      !eventData.availableForDraftIds ||
      eventData.availableForDraftIds.length <= teams.length
    ) {
      // Check if there are players besides captains
      setError(
        "Cannot start draft. Not enough participants available to be drafted."
      );
      return;
    }

    setActionLoading(true);
    setError(null);

    // Create Draft Document and Update Event Status in a Transaction
    const draftRef = doc(db, "drafts", eventId); // Use eventId as draftId for simplicity
    const eventRef = doc(db, "events", eventId);

    // 1. Prepare Draft Data
    const teamIds = teams.map((team) => team.id);
    // Simple shuffle function (Fisher-Yates)
    const shuffleArray = (array: string[]) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };
    const randomizedPickOrder = shuffleArray([...teamIds]); // Shuffle a copy

    try {
      await runTransaction(db, async (transaction) => {
        // Ensure event exists and status is appropriate (optional check inside transaction)
        const freshEventSnap = await transaction.get(eventRef);
        if (
          !freshEventSnap.exists() ||
          (freshEventSnap.data()?.status !== "setup" &&
            freshEventSnap.data()?.status !== "inviting" &&
            freshEventSnap.data()?.status !== "assigningCaptains")
        ) {
          // Allow starting from setup/inviting/assigning
          throw new Error(
            `Event status (${
              freshEventSnap.data()?.status
            }) prevents starting the draft.`
          );
        }

        // Create (set) the draft document
        transaction.set(draftRef, {
          eventId: eventData.id,
          status: "active", // Draft itself is active
          pickOrder: randomizedPickOrder,
          currentPickIndex: 0, // First pick
          roundNumber: 1,
          totalPicksMade: 0,
          // availablePlayers: eventData.availableForDraftIds // Can store initial list here if desired, but reading from event doc is safer
          lastPickTimestamp: serverTimestamp(),
        });

        // Update the event status
        transaction.update(eventRef, {
          status: "drafting",
        });
      });

      console.log("Draft started successfully!");
      // Refetch data to update UI (event status changes) or redirect
      fetchEventDetails(); // Refresh manage page state
      // Optionally redirect admin to draft page
      // router.push(`/event/${eventId}/draft`);
    } catch (err: any) {
      console.error("Error starting draft:", err);
      setError(`Failed to start draft. ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // --- Render Logic ---
  if (loading)
    return (
      <div className="container mx-auto p-4">Loading event details...</div>
    );
  if (error)
    return <div className="container mx-auto p-4 text-red-500">{error}</div>;
  if (!eventData)
    return (
      <div className="container mx-auto p-4">
        Event not found or access denied.
      </div>
    );

  const canStartDraft =
    teams.length === eventData.numberOfTeams &&
    (eventData.status === "setup" ||
      eventData.status === "inviting" ||
      eventData.status === "assigningCaptains");
  const isDraftingOrLater = ["drafting", "active", "completed"].includes(
    eventData.status
  );

  return (
    <div className="container mx-auto p-4 space-y-8">
      {/* Event Info */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-bold">Manage Event: {eventData.name}</h1>
          {/* Add Links to other event pages */}
          <div className="space-x-2">
            {isDraftingOrLater && (
              <Link
                href={`/event/${eventId}/draft`}
                className="text-blue-600 hover:underline"
              >
                View Draft
              </Link>
            )}
            <Link
              href={`/event/${eventId}/leaderboard`}
              className="text-blue-600 hover:underline"
            >
              View Leaderboard
            </Link>
          </div>
        </div>

        <p>
          <span className="font-semibold">Status:</span>{" "}
          <span
            className={`font-medium ${
              eventData.status === "drafting"
                ? "text-yellow-600"
                : eventData.status === "active"
                ? "text-green-600"
                : ""
            }`}
          >
            {eventData.status}
          </span>
        </p>
        <p>
          <span className="font-semibold">Required Teams:</span>{" "}
          {eventData.numberOfTeams}
        </p>
        <p>
          <span className="font-semibold">Created Teams:</span> {teams.length}
        </p>
        <p>
          <span className="font-semibold">Participants Accepted:</span>{" "}
          {participants.length}
        </p>
      </div>

      {/* Invitation Section (Only if status allows inviting) */}
      {eventData.status === "setup" ||
        (eventData.status === "inviting" && (
          <div className="p-6 bg-white rounded shadow-md border border-gray-200">
            <h2 className="text-xl font-semibold mb-4">Invite Participants</h2>
            <form onSubmit={handleInvite}>
              <div className="mb-4">
                <label
                  htmlFor="inviteEmail"
                  className="block text-gray-700 font-semibold mb-2"
                >
                  Participant Email:
                </label>
                <input
                  type="email"
                  id="inviteEmail"
                  value={inviteEmail} // Make sure 'inviteEmail' state exists
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setInviteError(null); // Clear error on typing
                    setInviteSuccess(null); // Clear success on typing
                  }}
                  required
                  className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
                  placeholder="example@email.com"
                />
              </div>

              {/* Display feedback messages */}
              {inviteError && (
                <p className="text-red-500 text-sm mb-3">{inviteError}</p>
              )}
              {inviteSuccess && (
                <p className="text-green-600 text-sm mb-3">{inviteSuccess}</p>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isInviting || !inviteEmail.trim()} // Ensure 'isInviting' state exists
                className={`w-full py-2 px-4 rounded text-white font-semibold ${
                  isInviting || !inviteEmail.trim()
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                {isInviting ? "Sending..." : "Send Invitation"}
              </button>
            </form>
            <form onSubmit={handleInvite}>
              <div className="mb-4">
                <label
                  htmlFor="inviteEmail"
                  className="block text-gray-700 font-semibold mb-2"
                >
                  Participant Email:
                </label>
                <input
                  type="email"
                  id="inviteEmail"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setInviteError(null);
                    setInviteSuccess(null);
                  }}
                  required
                  className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
                  placeholder="example@email.com"
                />
              </div>
              {inviteError && (
                <p className="text-red-500 text-sm mb-3">{inviteError}</p>
              )}
              {inviteSuccess && (
                <p className="text-green-600 text-sm mb-3">{inviteSuccess}</p>
              )}
              <button
                type="submit"
                // Check these variables: is isInviting true? Is inviteEmail empty or just spaces?
                disabled={isInviting || !inviteEmail.trim()}
                className={`w-full py-2 px-4 rounded text-white font-semibold ${
                  isInviting || !inviteEmail.trim()
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                {isInviting ? "Sending..." : "Send Invitation"}
              </button>
            </form>
          </div>
        ))}

      {/* Captain Assignment Section (Only before draft starts) */}
      {!isDraftingOrLater && (
        <div className="p-6 bg-white rounded shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">
            Assign Captains ({teams.length} / {eventData.numberOfTeams})
          </h2>
          {participants.length > 0 ? (
            <ul className="space-y-2">
              {participants.map((p) => (
                <li
                  key={p.uid}
                  className="flex justify-between items-center p-2 border-b"
                >
                  <span>
                    {p.displayName} ({p.role}){" "}
                    {p.teamId &&
                      `- Team ${
                        teams.find((t) => t.id === p.teamId)?.name ||
                        p.teamId.substring(0, 5)
                      }`}
                  </span>
                  {p.role === "participant" &&
                    teams.length < eventData.numberOfTeams && (
                      <button
                        onClick={() => handleMakeCaptain(p)}
                        disabled={actionLoading}
                        className="bg-blue-500 hover:bg-blue-700 text-white text-sm font-bold py-1 px-2 rounded disabled:bg-gray-400"
                      >
                        Make Captain
                      </button>
                    )}
                  {p.role === "captain" && (
                    <span className="text-sm text-green-600 font-semibold">
                      ✓ Captain
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">
              No participants have accepted invitations yet.
            </p>
          )}
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        </div>
      )}

      {/* Start Draft Section */}
      <div className="p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Draft Control</h2>
        {eventData.status === "drafting" && (
          <p className="text-yellow-600 font-medium mb-4">
            Draft is in progress.
          </p>
        )}
        {canStartDraft && (
          <button
            onClick={handleStartDraft}
            disabled={actionLoading}
            className="bg-green-600 hover:bg-green-800 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400"
          >
            {actionLoading ? "Starting..." : "Start Draft"}
          </button>
        )}
        {!canStartDraft && !isDraftingOrLater && (
          <p className="text-gray-500 italic">
            Cannot start draft until exactly {eventData.numberOfTeams} captains
            are assigned.
          </p>
        )}
        {isDraftingOrLater && (
          <Link
            href={`/event/${eventId}/draft`}
            className="bg-indigo-600 hover:bg-indigo-800 text-white font-bold py-2 px-4 rounded"
          >
            Go to Draft Page
          </Link>
        )}
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      </div>

      {/* Replace the Sub-Event Management Placeholder */}
      <div className="p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Sub-Events</h2>

        {/* Create Sub-Event Form (Only for Admin and likely after draft) */}
        {eventData.status !== "setup" &&
          eventData.status !== "inviting" && ( // Show form after inviting phase
            <form
              onSubmit={handleCreateSubEvent}
              className="mb-6 border-b pb-4"
            >
              <h3 className="text-lg font-medium mb-2">Create New Sub-Event</h3>
              <div className="mb-3">
                <label
                  htmlFor="subEventName"
                  className="block text-gray-700 font-semibold mb-1"
                >
                  Sub-Event Name:
                </label>
                <input
                  type="text"
                  id="subEventName"
                  value={subEventName}
                  onChange={(e) => setSubEventName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
                  placeholder="e.g., Testudo Run"
                />
              </div>
              {/* Add fields for dateTime, description etc. if needed */}
              {subEventError && (
                <p className="text-red-500 text-sm mb-2">{subEventError}</p>
              )}
              <button
                type="submit"
                disabled={subEventLoading}
                className="bg-purple-500 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded disabled:bg-gray-400"
              >
                {subEventLoading ? "Creating..." : "Create Sub-Event"}
              </button>
            </form>
          )}

        {/* List Existing Sub-Events */}
        <h3 className="text-lg font-medium mb-2">
          Existing Sub-Events ({subEvents.length})
        </h3>
        {subEvents.length > 0 ? (
          <ul className="space-y-2">
            {subEvents.map((sub) => (
              <li
                key={sub.id}
                className="flex justify-between items-center p-2 border rounded bg-gray-50"
              >
                <span>{sub.name}</span>
                {/* TODO: Link to a Sub-Event Detail/Manage Page */}
                <Link
                  href={`/event/${eventId}/sub-event/${sub.id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Manage/Score →
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">No sub-events created yet.</p>
        )}
      </div>

      {/* TODO: Add more management controls as needed */}
    </div>
  );
}

// You would create these components separately
// const CreateSubEventForm = ({ eventId }: { eventId: string }) => { /* ... form logic ... */ return null; };
// const SubEventList = ({ eventId }: { eventId: string }) => { /* ... list logic ... */ return null; };
