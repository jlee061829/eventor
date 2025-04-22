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
  getDocs,
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
  eventId: string;
  createdAt: Timestamp;
}

interface EventData {
  id: string;
  name: string;
  adminId: string;
  status: string;
  numberOfTeams: number;
  participantEmails: string[];
  participantIds: string[];
  availableForDraftIds: string[];
  createdAt: Timestamp;
}

// --- Component Start ---
export default function ManageEventPage() {
  // --- State Variables ---
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;

  const [eventData, setEventData] = useState<EventData | null>(null);
  const [participants, setParticipants] = useState<ParticipantProfile[]>([]);
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [subEvents, setSubEvents] = useState<{ id: string; name: string }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false); // New state for access control

  // Invite specific state
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Sub-event specific state
  const [subEventName, setSubEventName] = useState("");
  const [subEventLoading, setSubEventLoading] = useState(false);
  const [subEventError, setSubEventError] = useState<string | null>(null);

  // Action loading state
  const [actionLoading, setActionLoading] = useState(false);

  // --- Fetch Event Details (MODIFIED ACCESS CHECK) ---
  const fetchEventDetails = useCallback(async () => {
    if (!eventId || !currentUser) {
      setLoading(false);
      setError("Authentication required to view event details.");
      return;
    }

    setLoading(true);
    setError(null);
    setAccessDenied(false); // Reset access denied state
    setParticipants([]);
    setTeams([]);
    setSubEvents([]);

    try {
      // Fetch Event Data first
      const eventDocRef = doc(db, "events", eventId);
      const eventDocSnap = await getDoc(eventDocRef);

      if (!eventDocSnap.exists()) {
        throw new Error("Event not found.");
      }

      const fetchedEventData = {
        id: eventDocSnap.id,
        ...eventDocSnap.data(),
      } as EventData;

      // --- *** MODIFIED ACCESS CHECK *** ---
      // Check if the current user is EITHER the admin OR a participant
      const isAdmin = fetchedEventData.adminId === currentUser.uid;
      // Ensure participantIds exists and is an array before checking includes
      const isParticipant =
        Array.isArray(fetchedEventData.participantIds) &&
        fetchedEventData.participantIds.includes(currentUser.uid);

      if (!isAdmin && !isParticipant) {
        // If user is NEITHER admin nor participant, deny access
        setAccessDenied(true);
        setEventData(null); // Clear data if access denied
      } else {
        // If user IS admin or participant, proceed
        setEventData(fetchedEventData);

        // Fetch Participants (if needed for display - consider optimizing if only admin needs full list)
        if (
          fetchedEventData.participantIds &&
          fetchedEventData.participantIds.length > 0
        ) {
          const usersCollectionRef = collection(db, "users");
          // Handle potential chunking for > 30 participants
          const participantChunks = [];
          for (let i = 0; i < fetchedEventData.participantIds.length; i += 30) {
            participantChunks.push(
              fetchedEventData.participantIds.slice(i, i + 30)
            );
          }
          const participantPromises = participantChunks.map((chunk) =>
            getDocs(query(usersCollectionRef, where(documentId(), "in", chunk)))
          );
          const participantSnapshots = await Promise.all(participantPromises);
          const fetchedParticipants = participantSnapshots.flatMap((snapshot) =>
            snapshot.docs.map(
              (doc) =>
                ({
                  uid: doc.id,
                  displayName: doc.data().displayName || "N/A",
                  role: doc.data().role || "participant",
                  teamId: doc.data().teamId || null,
                } as ParticipantProfile)
            )
          );
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
        const fetchedTeams = teamsSnapshot.docs.map(
          (doc) =>
            ({
              id: doc.id,
              ...doc.data(),
            } as TeamData)
        );
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
      }
      // --- *** END MODIFIED ACCESS CHECK *** ---
    } catch (err: any) {
      console.error("Error fetching event details:", err);
      // If the error wasn't explicitly set to access denied, show general error
      if (!accessDenied) {
        setError("Failed to load event data. " + err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, currentUser]); // Removed router from dependencies as it wasn't used here

  useEffect(() => {
    if (currentUser && eventId) {
      fetchEventDetails();
    } else if (!currentUser) {
      setLoading(false);
      setError("Authentication required.");
      setEventData(null); // Clear data if user logs out
    }
  }, [currentUser, eventId, fetchEventDetails]);

  // --- Handler Functions (No logical change needed, security rules enforce permissions) ---
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !eventData || !currentUser) {
      setInviteError("Email required, event loaded, and user logged in.");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(inviteEmail)) {
      setInviteError("Invalid email format.");
      return;
    }
    // --- Console logs for debugging (can be removed later) ---
    console.log("--- Invite Debug ---");
    console.log("Event ID:", eventData?.id);
    console.log("Event Admin ID:", eventData?.adminId);
    console.log("Current User UID:", currentUser?.uid);
    console.log("Is Admin?:", currentUser?.uid === eventData?.adminId);
    console.log(
      "Event Name:",
      eventData?.name,
      "| Type:",
      typeof eventData?.name
    );
    console.log("--------------------");
    // --- End logs ---
    setIsInviting(true);
    setInviteError(null);
    setInviteSuccess(null);
    const emailToInvite = inviteEmail.trim().toLowerCase();
    try {
      // Duplicate Check (Client-side check, consider Cloud Function for robustness)
      const invitesCol = collection(db, "invites");
      const q = query(
        invitesCol,
        where("eventId", "==", eventData.id),
        where("recipientEmail", "==", emailToInvite)
      );
      const existingInviteSnap = await getDocs(q);
      if (!existingInviteSnap.empty) {
        throw new Error(`${emailToInvite} already invited/accepted.`);
      }
      // 1. Create invite doc
      await addDoc(collection(db, "invites"), {
        eventId: eventData.id,
        recipientEmail: emailToInvite,
        status: "pending",
        sentBy: currentUser.uid,
        createdAt: serverTimestamp(),
        eventName: eventData.name,
      });
      // 2. Update event doc (participantEmails)
      const eventRef = doc(db, "events", eventData.id);
      await updateDoc(eventRef, {
        participantEmails: arrayUnion(emailToInvite),
      });
      setInviteSuccess(`Invitation sent to ${emailToInvite}!`);
      setInviteEmail("");
    } catch (err: any) {
      console.error("Error sending invitation:", err);
      setInviteError(err.message || "Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  };

  const handleCreateSubEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventData || !subEventName.trim() || !currentUser) return;
    // Client-side check for admin (optional, rules enforce)
    if (currentUser.uid !== eventData.adminId) {
      setSubEventError("Permission Denied");
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
      // Refetch sub-events
      const subEventsQuery = query(
        collection(db, "subEvents"),
        where("eventId", "==", eventId)
      );
      const subEventsSnapshot = await getDocs(subEventsQuery);
      const fetchedSubEvents = subEventsSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name || "Unnamed",
      }));
      setSubEvents(fetchedSubEvents);
    } catch (err: any) {
      console.error("Error creating sub-event:", err);
      setSubEventError("Failed to create sub-event: " + err.message);
    } finally {
      setSubEventLoading(false);
    }
  };

  const handleMakeCaptain = async (participant: ParticipantProfile) => {
    if (!eventData || !currentUser) return;
    // Client-side checks (optional, rules enforce)
    if (currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length >= eventData.numberOfTeams) {
      setError(`Max teams (${eventData.numberOfTeams}) reached.`);
      return;
    }
    if (participant.role !== "participant") {
      setError(`${participant.displayName} already a ${participant.role}.`);
      return;
    }

    setActionLoading(true);
    setError(null);
    const batch = writeBatch(db);
    const userRef = doc(db, "users", participant.uid);
    const newTeamRef = doc(collection(db, "teams"));
    try {
      const existingTeamNumbers = teams.map((t) =>
        parseInt(t.name.match(/\d+$/)?.[0] || "0", 10)
      );
      const nextTeamNumber = Math.max(0, ...existingTeamNumbers) + 1;
      // Create Team
      batch.set(newTeamRef, {
        eventId: eventData.id,
        name: `Team ${nextTeamNumber}`,
        captainId: participant.uid,
        memberIds: [participant.uid],
        createdAt: serverTimestamp(),
      });
      // Update User Role & Team ID
      batch.update(userRef, { role: "captain", teamId: newTeamRef.id });
      // Update Event's Available For Draft List
      const eventRef = doc(db, "events", eventData.id);
      batch.update(eventRef, {
        availableForDraftIds: (eventData.availableForDraftIds || []).filter(
          (id) => id !== participant.uid
        ),
      });
      await batch.commit();
      console.log(`${participant.displayName} promoted to captain`);
      fetchEventDetails(); // Refetch needed
    } catch (err: any) {
      console.error("Error making captain:", err);
      setError(`Failed to make captain: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartDraft = async () => {
    if (!eventData || !currentUser) return;
    // Client-side checks (optional, rules enforce)
    if (currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length !== eventData.numberOfTeams) {
      setError(`Need ${eventData.numberOfTeams} teams, have ${teams.length}.`);
      return;
    }
    if (["drafting", "active", "completed"].includes(eventData.status)) {
      setError(`Event status '${eventData.status}' prevents starting draft.`);
      return;
    }
    if ((eventData.availableForDraftIds || []).length === 0) {
      setError("No participants available to draft.");
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
          throw new Error("Event disappeared.");
        }
        const freshEventData = freshEventSnap.data();
        if (
          !freshEventData ||
          !["setup", "inviting", "assigningCaptains"].includes(
            freshEventData.status
          )
        ) {
          throw new Error(
            `Event status (${freshEventData?.status}) prevents starting draft.`
          );
        }
        // Set draft doc
        transaction.set(draftRef, {
          eventId: eventData.id,
          status: "active",
          pickOrder: randomizedPickOrder,
          currentPickIndex: 0,
          roundNumber: 1,
          totalPicksMade: 0,
          lastPickTimestamp: serverTimestamp(),
        });
        // Update event status
        transaction.update(eventRef, { status: "drafting" });
      });
      console.log("Draft started!");
      fetchEventDetails(); // Refresh state
    } catch (err: any) {
      console.error("Error starting draft:", err);
      setError(`Failed to start draft: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // --- *** RENDER LOGIC *** ---

  // Determine if the current user is the admin for this specific event
  const isAdmin = currentUser?.uid === eventData?.adminId;

  // --- Loading, Access Denied, Error Handling ---
  if (loading)
    return (
      <div className="container mx-auto p-4 text-center">
        Loading event details...
      </div>
    );
  if (accessDenied)
    return (
      <div className="container mx-auto p-4 text-center text-red-500">
        Access Denied: You are not authorized to view this event.
      </div>
    );
  if (error)
    return <div className="container mx-auto p-4 text-red-500">{error}</div>;
  // If eventData is null after loading without error/accessDenied, something unexpected happened
  if (!eventData)
    return (
      <div className="container mx-auto p-4 text-center text-gray-500">
        Event data could not be loaded.
      </div>
    );

  // --- Calculate status conditions based on fetched eventData ---
  const canAssignCaptains = !["drafting", "active", "completed"].includes(
    eventData.status
  );
  const canInvite = ["setup", "inviting"].includes(eventData.status);
  const canStartDraft =
    teams.length === eventData.numberOfTeams &&
    ["setup", "inviting", "assigningCaptains"].includes(eventData.status) &&
    (eventData.availableForDraftIds || []).length > 0;
  const isDraftingOrLater = ["drafting", "active", "completed"].includes(
    eventData.status
  );
  const canCreateSubEvents = !["setup", "inviting"].includes(eventData.status);

  // --- Main Page Content ---
  return (
    <div className="container mx-auto p-4 space-y-8">
      {/* --- Event Info (Visible to Admin & Participants) --- */}
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
          <h1 className="text-3xl font-bold mb-2 sm:mb-0">
            Event: {eventData.name}
          </h1>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <p>
            <span className="font-semibold">Status:</span>{" "}
            <span className={`font-medium $`}>{eventData.status}</span>
          </p>
          <p>
            <span className="font-semibold">Required Teams:</span>{" "}
            {eventData.numberOfTeams}
          </p>
          <p>
            <span className="font-semibold">Created Teams:</span> {teams.length}
          </p>
          <p>
            <span className="font-semibold">Participants:</span>{" "}
            {participants.length}
          </p>
        </div>
      </div>

      {/* --- *** CONDITIONAL ADMIN SECTIONS *** --- */}

      {/* Invitation Section (Admin Only) */}
      {isAdmin && canInvite && (
        <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
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
              disabled={isInviting || !inviteEmail.trim()}
              className={`w-full py-2 px-4 rounded text-white font-semibold ${
                isInviting || !inviteEmail.trim()
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600"
              }`}
            >
              {isInviting ? "Sending..." : "Send Invitation"}
            </button>
          </form>
        </div>
      )}

      {/* Captain Assignment Section (Admin Only) */}
      {isAdmin && canAssignCaptains && (
        <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">
            Assign Captains ({teams.length} / {eventData.numberOfTeams})
          </h2>
          {participants.length > 0 ? (
            <ul className="space-y-2">
              {participants.map((p) => (
                <li
                  key={p.uid}
                  className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2 border-b"
                >
                  <span className="mb-1 sm:mb-0">
                    {p.displayName} ({p.role}){" "}
                    {p.teamId &&
                      `- ${
                        teams.find((t) => t.id === p.teamId)?.name ||
                        "Assigned Team"
                      }`}
                  </span>
                  {p.role === "participant" &&
                    teams.length < eventData.numberOfTeams && (
                      <button
                        onClick={() => handleMakeCaptain(p)}
                        disabled={actionLoading}
                        className="bg-purple-500 hover:bg-purple-700 text-white text-xs sm:text-sm font-bold py-1 px-2 rounded disabled:bg-gray-400 self-start sm:self-center"
                      >
                        {actionLoading ? "Assigning..." : "Make Captain"}
                      </button>
                    )}
                  {p.role === "captain" && (
                    <span className="text-sm text-green-600 font-semibold self-start sm:self-center">
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

      {/* Draft Control Section (Admin Only Actions) */}
      {isAdmin && (
        <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
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
              className="bg-green-600 hover:bg-green-800 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400 mr-2"
            >
              {actionLoading ? "Starting..." : "Start Draft"}
            </button>
          )}
          {!isDraftingOrLater && teams.length !== eventData.numberOfTeams && (
            <p className="text-gray-500 italic mt-2 text-sm">
              Cannot start draft until exactly {eventData.numberOfTeams}{" "}
              captains are assigned.
            </p>
          )}
          {!isDraftingOrLater &&
            teams.length === eventData.numberOfTeams &&
            (eventData.availableForDraftIds || []).length === 0 && (
              <p className="text-gray-500 italic mt-2 text-sm">
                Cannot start draft - no participants available (besides
                captains).
              </p>
            )}
          {isDraftingOrLater && (
            <Link
              href={`/event/${eventId}/draft`}
              className="bg-indigo-600 hover:bg-indigo-800 text-white font-bold py-2 px-4 rounded inline-block"
            >
              Go to Draft Page
            </Link>
          )}
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        </div>
      )}

      {/* --- Sections Visible to Admin & Participants --- */}

      {/* Sub-Events Section (Create: Admin Only, List: All Authorized) */}
      <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Sub-Events</h2>
        {/* Create Form (Admin Only) */}
        {isAdmin && canCreateSubEvents && (
          <form onSubmit={handleCreateSubEvent} className="mb-6 border-b pb-4">
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
        {/* List (Visible to All Authorized) */}
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
                {/* Link to sub-event details - might need permission checks on that page too */}
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

      {/* Participant List (Optional - Visible to All Authorized) */}
      <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">
          Participants ({participants.length})
        </h2>
        {participants.length > 0 ? (
          <ul className="space-y-2">
            {participants.map((p) => (
              <li key={p.uid} className="p-2 border-b">
                {p.displayName} ({p.role}){" "}
                {p.teamId &&
                  `- ${
                    teams.find((t) => t.id === p.teamId)?.name ||
                    "Assigned Team"
                  }`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">
            No participants have joined yet.
          </p>
        )}
      </div>

      {/* Team List (Optional - Visible to All Authorized) */}
      <div className="p-4 md:p-6 bg-white rounded shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold mb-4">Teams ({teams.length})</h2>
        {teams.length > 0 ? (
          <ul className="space-y-2">
            {teams.map((t) => (
              <li key={t.id} className="p-2 border-b">
                <span className="font-semibold">{t.name}</span> - Captain:{" "}
                {participants.find((p) => p.uid === t.captainId)?.displayName ||
                  "N/A"}
                {/* Optionally list members */}
                {/* <ul className="text-sm pl-4">
                         {t.memberIds.map(mid => <li key={mid}>{participants.find(p=>p.uid === mid)?.displayName || mid.substring(0,5)}</li>)}
                      </ul> */}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500 italic">
            No teams created yet (captains not assigned).
          </p>
        )}
      </div>
    </div>
  );
}
