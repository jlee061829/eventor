// src/app/(protected)/event/[eventId]/manage/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext"; // Make sure this path is correct
import { db } from "@/firebase.config"; // Make sure this path is correct
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
  getDocs, // <-- Make sure getDocs is imported
  writeBatch,
  Timestamp,
  runTransaction,
  documentId,
} from "firebase/firestore";

// --- Interfaces (Keep your existing interfaces) ---
interface ParticipantProfile {
  uid: string;
  displayName: string;
  role: string;
  teamId?: string | null;
}

interface TeamData {
  id: string;
  name: string;
  captainId: string;
  memberIds: string[];
  eventId: string; // Ensure eventId is part of the team data
  createdAt: Timestamp; // Keep timestamps consistent
}

interface EventData {
  id: string;
  name: string;
  adminId: string;
  status: string;
  numberOfTeams: number;
  participantEmails: string[]; // Emails of those invited
  participantIds: string[]; // UIDs of those who accepted
  availableForDraftIds: string[]; // UIDs available after captains assigned
  createdAt: Timestamp;
}

// --- Component Start ---
export default function ManageEventPage() {
  // --- State Variables (Keep your existing state) ---
  const { user: currentUser, userProfile } = useAuth(); // Assuming useAuth provides userProfile with role
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

  // Invite specific state
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);

  // --- Fetch Event Details (Keep your existing fetch logic) ---
  const fetchEventDetails = useCallback(async () => {
    // Keep your existing fetchEventDetails logic...
    // Added fetching sub-events inside the main try block for consistency
    if (!eventId || !currentUser) return;
    setLoading(true);
    setError(null);
    setParticipants([]);
    setTeams([]);
    setSubEvents([]); // Also reset sub-events

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

      // Use userProfile.role for checks if available, otherwise fallback/adjust logic
      // For this page, we primarily need to check if they are the event admin
      if (fetchedEventData.adminId !== currentUser.uid) {
        throw new Error("Access Denied: You are not the admin of this event.");
      }
      setEventData(fetchedEventData);

      // Fetch Participants
      if (
        fetchedEventData.participantIds &&
        fetchedEventData.participantIds.length > 0
      ) {
        const usersCollectionRef = collection(db, "users");
        if (fetchedEventData.participantIds.length > 30) {
          console.warn(
            "Fetching more than 30 participants, consider chunking."
          );
        }
        const usersQuery = query(
          usersCollectionRef,
          where(
            documentId(),
            "in",
            fetchedEventData.participantIds.slice(0, 30)
          ) // Limit to 30 for 'in' query
          // TODO: Add logic here to handle > 30 participant IDs if necessary (multiple queries)
        );
        const usersSnapshot = await getDocs(usersQuery);
        const fetchedParticipants = usersSnapshot.docs.map((doc) => ({
          uid: doc.id,
          displayName: doc.data().displayName || "N/A",
          role: doc.data().role || "participant", // Assuming role is stored in user doc
          teamId: doc.data().teamId || null, // Assuming teamId is stored in user doc
        })) as ParticipantProfile[];
        setParticipants(fetchedParticipants);
      } else {
        setParticipants([]);
      }

      // Fetch Teams
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

      // Fetch Sub-Events
      const subEventsQuery = query(
        collection(db, "subEvents"),
        where("eventId", "==", eventId)
      );
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
        // Consider redirecting only if the core event fetch failed due to access
        // router.push("/dashboard");
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, currentUser, router]); // Removed router dependency if redirect only happens on critical error

  useEffect(() => {
    if (currentUser && eventId) {
      // Ensure currentUser and eventId are available
      fetchEventDetails();
    } else if (!currentUser) {
      // Handle case where user is not logged in yet or context is loading
      setLoading(false); // Stop loading indicator
      setError("Authentication required."); // Show appropriate message
    }
  }, [currentUser, eventId, fetchEventDetails]); // Depend on currentUser and eventId

  // --- Invitation Logic ---
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !eventData || !currentUser) {
      setInviteError("Email is required and event data must be loaded.");
      return;
    }
    // Basic Email Validation
    if (!/\S+@\S+\.\S+/.test(inviteEmail)) {
      setInviteError("Please enter a valid email address.");
      return;
    }

    setIsInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    const emailToInvite = inviteEmail.trim().toLowerCase(); // Normalize email

    try {
      // *** ADDED: Check if already invited to this event ***
      const invitesCol = collection(db, "invites");
      const q = query(
        invitesCol,
        where("eventId", "==", eventData.id),
        where("recipientEmail", "==", emailToInvite) // Check against the normalized email
      );
      const existingInviteSnap = await getDocs(q);
      if (!existingInviteSnap.empty) {
        // Optional: Check status? Maybe resend if declined? For now, just prevent duplicate pending invites.
        // const existingStatus = existingInviteSnap.docs[0].data().status;
        // if (existingStatus === 'pending' || existingStatus === 'accepted') {
        throw new Error(
          `${emailToInvite} has already been invited or accepted for this event.`
        );
        // }
      }
      // *** END ADDED CHECK ***

      // Use a batch write to perform both actions atomically if desired,
      // though creating the invite first is usually fine.
      // const batch = writeBatch(db);

      // 1. Create the invite document
      const inviteDocRef = await addDoc(collection(db, "invites"), {
        eventId: eventData.id,
        recipientEmail: emailToInvite,
        status: "pending",
        sentBy: currentUser.uid, // Use currentUser.uid
        createdAt: serverTimestamp(),
        eventName: eventData.name, // Keep eventName if your invitation page uses it
      });
      // batch.set(doc(db, "invites", inviteDocRef.id), { ... }); // If using batch

      // 2. Update the event document (optional, depending on your needs)
      // This array is useful for quickly seeing who was invited, but the 'invites' collection is the source of truth for status.
      const eventRef = doc(db, "events", eventData.id);
      await updateDoc(eventRef, {
        participantEmails: arrayUnion(emailToInvite),
      });
      // batch.update(eventRef, { participantEmails: arrayUnion(emailToInvite) }); // If using batch

      // await batch.commit(); // If using batch

      setInviteSuccess(`Invitation sent to ${emailToInvite}!`);
      setInviteEmail(""); // Clear the input field
      // No need to refetch all event details just for this, unless you display participantEmails list here.
      // fetchEventDetails(); // Remove if not displaying participantEmails directly
    } catch (err: any) {
      console.error("Error sending invitation:", err);
      // Display specific error from duplicate check
      setInviteError(err.message || "Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  };

  // --- Keep handleCreateSubEvent ---
  const handleCreateSubEvent = async (e: React.FormEvent) => {
    // ... (keep your existing logic)
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
      await addDoc(subEventsCollectionRef, {
        eventId: eventData.id,
        name: subEventName.trim(),
        assignedParticipants: {},
        status: "upcoming",
        createdAt: serverTimestamp(),
      });
      setSubEventName("");
      // Fetch ONLY sub-events again for efficiency, or update state directly
      const subEventsQuery = query(
        collection(db, "subEvents"),
        where("eventId", "==", eventId)
      );
      const subEventsSnapshot = await getDocs(subEventsQuery);
      const fetchedSubEvents = subEventsSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "Unnamed Sub-Event",
      }));
      setSubEvents(fetchedSubEvents);
      // setSubEvents(prev => [...prev, { id: newSubEvent.id, name: subEventName.trim() }]); // Alternative direct update
    } catch (err: any) {
      console.error("Error creating sub-event:", err);
      setSubEventError("Failed to create sub-event. " + err.message);
    } finally {
      setSubEventLoading(false);
    }
  };

  // --- Keep handleMakeCaptain ---
  const handleMakeCaptain = async (participant: ParticipantProfile) => {
    // ... (keep your existing logic)
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length >= eventData.numberOfTeams) {
      setError(
        `Cannot assign more captains. Max teams (${eventData.numberOfTeams}) reached.`
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
      // Find next available team name/number
      const existingTeamNumbers = teams.map((t) => {
        const match = t.name.match(/^Team (\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
      const nextTeamNumber = Math.max(0, ...existingTeamNumbers) + 1;

      // 1. Create Team
      batch.set(newTeamRef, {
        eventId: eventData.id,
        name: `Team ${nextTeamNumber}`, // Better naming
        captainId: participant.uid,
        memberIds: [participant.uid],
        createdAt: serverTimestamp(),
      });

      // 2. Update User Role & Team ID
      batch.update(userRef, {
        role: "captain",
        teamId: newTeamRef.id,
      });

      // 3. Update Event's Available For Draft List (remove new captain)
      const eventRef = doc(db, "events", eventData.id);
      batch.update(eventRef, {
        // Ensure availableForDraftIds is treated as an array even if null/undefined initially
        availableForDraftIds: (eventData.availableForDraftIds || []).filter(
          (id) => id !== participant.uid
        ),
      });

      await batch.commit();
      console.log(
        `${participant.displayName} promoted to captain of Team ${nextTeamNumber}`
      );
      fetchEventDetails(); // Refetch needed to update participants, teams, eventData (available list)
    } catch (err: any) {
      console.error("Error making captain:", err);
      setError(
        `Failed to make ${participant.displayName} a captain. ${err.message}`
      );
    } finally {
      setActionLoading(false);
    }
  };

  // --- Keep handleStartDraft ---
  const handleStartDraft = async () => {
    // ... (keep your existing logic)
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length !== eventData.numberOfTeams) {
      setError(
        `Cannot start draft. Expected ${eventData.numberOfTeams} teams, found ${teams.length}.`
      );
      return;
    }
    if (["drafting", "active", "completed"].includes(eventData.status)) {
      setError(
        `Draft cannot be started. Event status is '${eventData.status}'.`
      );
      return;
    }
    // Ensure availableForDraftIds exists and has players *beyond* the captains
    const numAvailableToDraft = (eventData.availableForDraftIds || []).length;
    if (numAvailableToDraft === 0) {
      setError(
        "Cannot start draft. No participants available to be drafted (besides captains)."
      );
      return;
    }

    setActionLoading(true);
    setError(null);

    const draftRef = doc(db, "drafts", eventId);
    const eventRef = doc(db, "events", eventId);

    const teamIds = teams.map((team) => team.id);
    const shuffleArray = (array: string[]) => {
      /* ... keep shuffle logic ... */
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };
    const randomizedPickOrder = shuffleArray([...teamIds]);

    try {
      await runTransaction(db, async (transaction) => {
        const freshEventSnap = await transaction.get(eventRef);
        if (!freshEventSnap.exists()) {
          throw new Error("Event disappeared unexpectedly.");
        }
        const freshEventData = freshEventSnap.data();
        if (
          !freshEventData ||
          (freshEventData.status !== "setup" &&
            freshEventData.status !== "inviting" &&
            freshEventData.status !== "assigningCaptains")
        ) {
          throw new Error(
            `Event status (${
              freshEventData?.status || "unknown"
            }) prevents starting the draft.`
          );
        }

        // Set the draft document
        transaction.set(draftRef, {
          eventId: eventData.id,
          status: "active",
          pickOrder: randomizedPickOrder,
          currentPickIndex: 0,
          roundNumber: 1,
          totalPicksMade: 0,
          lastPickTimestamp: serverTimestamp(), // Use Firestore server timestamp
          // availablePlayers: eventData.availableForDraftIds // Store initial snapshot if needed
        });

        // Update event status
        transaction.update(eventRef, { status: "drafting" });
      });

      console.log("Draft started successfully!");
      fetchEventDetails(); // Refresh manage page state (event status changes)
      // Optionally redirect: router.push(`/event/${eventId}/draft`);
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
      <div className="container mx-auto p-4 text-center">
        Loading event details...
      </div>
    );
  // Show specific error or a generic message if eventData is null after loading completed without error state
  if (!eventData && !error)
    return (
      <div className="container mx-auto p-4 text-center text-red-500">
        Event data could not be loaded or access denied.
      </div>
    );
  if (error)
    return <div className="container mx-auto p-4 text-red-500">{error}</div>;
  // We check error first, so if eventData is null here, it's unexpected unless loading didn't finish?
  // Let's assume if we reach here, eventData is valid.
  if (!eventData)
    return (
      <div className="container mx-auto p-4 text-center text-red-500">
        An unexpected error occurred.
      </div>
    );

  // Simplify conditions
  const canAssignCaptains = !["drafting", "active", "completed"].includes(
    eventData.status
  );
  const canInvite = ["setup", "inviting"].includes(eventData.status);
  const canStartDraft =
    teams.length === eventData.numberOfTeams &&
    ["setup", "inviting", "assigningCaptains"].includes(eventData.status) &&
    (eventData.availableForDraftIds || []).length > 0; // Must have players to draft
  const isDraftingOrLater = ["drafting", "active", "completed"].includes(
    eventData.status
  );
  const canCreateSubEvents = !["setup", "inviting"].includes(eventData.status); // Allow once captains can be assigned

  return (
    <div className="container mx-auto p-4 space-y-8">
      {/* --- Event Info (Keep as is) --- */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-3xl font-bold">Manage Event: {eventData.name}</h1>
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
              eventData.status === "setup"
                ? "text-gray-600"
                : eventData.status === "inviting"
                ? "text-blue-600"
                : eventData.status === "assigningCaptains"
                ? "text-purple-600"
                : eventData.status === "drafting"
                ? "text-yellow-600"
                : eventData.status === "active"
                ? "text-green-600"
                : eventData.status === "completed"
                ? "text-red-600"
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
        {/* Display emails invited (optional) */}
        {/* <p><span className="font-semibold">Invited Emails:</span> {eventData.participantEmails?.join(', ') || 'None'}</p> */}
      </div>

      {/* --- Invitation Section (Cleaned Up) --- */}
      {canInvite && (
        <div className="p-6 bg-white rounded shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">Invite Participants</h2>
          {/* REMOVED DUPLICATE FORM - This is the single correct form */}
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
                value={inviteEmail} // Correctly bound
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
              disabled={isInviting || !inviteEmail.trim()} // Correctly disabled
              className={`w-full py-2 px-4 rounded text-white font-semibold ${
                isInviting || !inviteEmail.trim()
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600" // Changed color to blue for invites
              }`}
            >
              {isInviting ? "Sending..." : "Send Invitation"}
            </button>
          </form>
          {/* Optional: Display existing invites here */}
          {/* <div className="mt-6"> ... logic to display invites fetched from 'invites' collection ... </div> */}
        </div>
      )}

      {/* --- Captain Assignment Section (Keep as is, maybe add clearer condition) --- */}
      {canAssignCaptains && (
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
                      `- ${
                        teams.find((t) => t.id === p.teamId)?.name ||
                        "Assigned Team"
                      }`}
                  </span>
                  {/* Allow making captain only if they are 'participant' AND team limit not reached */}
                  {p.role === "participant" &&
                    teams.length < eventData.numberOfTeams && (
                      <button
                        onClick={() => handleMakeCaptain(p)}
                        disabled={actionLoading}
                        className="bg-purple-500 hover:bg-purple-700 text-white text-sm font-bold py-1 px-2 rounded disabled:bg-gray-400"
                      >
                        {actionLoading ? "Assigning..." : "Make Captain"}
                      </button>
                    )}
                  {p.role === "captain" && (
                    <span className="text-sm text-green-600 font-semibold">
                      ✓ Captain
                    </span>
                  )}
                  {/* Optionally add button to REMOVE captain status if needed */}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">
              No participants have accepted invitations yet.
            </p>
          )}
          {/* Show error specific to this section if needed, or rely on general error state */}
          {/* {assignCaptainError && <p className="text-red-500 text-sm mt-4">{assignCaptainError}</p>} */}
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}{" "}
          {/* Display general action errors */}
        </div>
      )}

      {/* --- Start Draft Section (Keep as is, maybe add clearer condition) --- */}
      <div className="p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Draft Control</h2>
        {eventData.status === "drafting" && (
          <p className="text-yellow-600 font-medium mb-4">
            Draft is in progress.
          </p>
        )}
        {/* Show Start Draft button only if conditions are met */}
        {canStartDraft && (
          <button
            onClick={handleStartDraft}
            disabled={actionLoading}
            className="bg-green-600 hover:bg-green-800 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400 mr-2" // Added margin
          >
            {actionLoading ? "Starting..." : "Start Draft"}
          </button>
        )}
        {/* Explain why draft can't be started if applicable */}
        {!isDraftingOrLater && teams.length !== eventData.numberOfTeams && (
          <p className="text-gray-500 italic mt-2">
            Cannot start draft until exactly {eventData.numberOfTeams} captains
            are assigned.
          </p>
        )}
        {!isDraftingOrLater &&
          teams.length === eventData.numberOfTeams &&
          (eventData.availableForDraftIds || []).length === 0 && (
            <p className="text-gray-500 italic mt-2">
              Cannot start draft because there are no participants available to
              be drafted (besides captains).
            </p>
          )}
        {/* Show Go to Draft Page link if drafting or later */}
        {isDraftingOrLater && (
          <Link
            href={`/event/${eventId}/draft`}
            className="bg-indigo-600 hover:bg-indigo-800 text-white font-bold py-2 px-4 rounded inline-block" // Make it inline-block for spacing
          >
            Go to Draft Page
          </Link>
        )}
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}{" "}
        {/* Display general action errors */}
      </div>

      {/* --- Sub-Events Section (Keep as is, maybe add clearer condition) --- */}
      <div className="p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Sub-Events</h2>
        {/* Create Sub-Event Form */}
        {canCreateSubEvents && ( // Show form only when appropriate
          <form onSubmit={handleCreateSubEvent} className="mb-6 border-b pb-4">
            {/* ... form elements ... */}
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
                placeholder="e.g., Trivia Challenge"
              />
            </div>
            {subEventError && (
              <p className="text-red-500 text-sm mb-2">{subEventError}</p>
            )}
            <button
              type="submit"
              disabled={subEventLoading}
              className="bg-teal-500 hover:bg-teal-700 text-white font-semibold py-2 px-4 rounded disabled:bg-gray-400"
            >
              {subEventLoading ? "Creating..." : "Create Sub-Event"}
            </button>
          </form>
        )}
        {!canCreateSubEvents && (
          <p className="text-gray-500 italic mb-4">
            Sub-events can be created after the initial setup/invitation phase.
          </p>
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
    </div>
  );
}
