// src/app/(protected)/event/[eventId]/manage/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
  arrayRemove, // Ensure arrayRemove is imported
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp,
  runTransaction,
  documentId,
} from "firebase/firestore";

// --- Interfaces ---
interface ParticipantProfile {
  uid: string;
  displayName: string;
  email: string;
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
// --- NEW: Score Input Interface (defined here) ---
interface ScoreInput {
  teamId: string;
  teamName: string; // Added for convenience in UI/messages
  currentPoints: string; // Value currently in the input field (string)
  originalPoints: number | null; // Points fetched from DB (null if no score exists)
  scoreDocId: string | null;
}

export default function ManageEventPage() {
  // --- State ---
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
  const [error, setError] = useState<string | null>(null); // General/Action Error
  const [accessDenied, setAccessDenied] = useState(false);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Sub-event state
  const [subEventName, setSubEventName] = useState("");
  const [subEventDescription, setSubEventDescription] = useState("");
  const [subEventLoading, setSubEventLoading] = useState(false);
  const [subEventError, setSubEventError] = useState<string | null>(null);

  // Action/Delete state
  const [actionLoading, setActionLoading] = useState(false); // General loading for buttons like Activate, Start Draft
  const [participantActionLoading, setParticipantActionLoading] = useState<
    string | null
  >(null); // Specific UID for Make/Remove Captain/Participant
  const [isDeleting, setIsDeleting] = useState(false);

  // --- *** ADDED State for Score Entry *** ---
  const [selectedSubEventIdForScoring, setSelectedSubEventIdForScoring] =
    useState<string>("");
  const [scoresForSelectedSubEvent, setScoresForSelectedSubEvent] = useState<
    ScoreInput[]
  >([]);
  const [isSubmittingScores, setIsSubmittingScores] = useState(false);
  const [scoreSubmitError, setScoreSubmitError] = useState<string | null>(null);
  // --- *** END ADDED State *** ---

  // --- Fetch Logic ---
  const fetchEventDetails = useCallback(async () => {
    if (!eventId || !currentUser) {
      setLoading(false);
      setError("Auth required.");
      setEventData(null);
      setAccessDenied(true);
      return;
    }
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    setParticipants([]);
    setTeams([]);
    setSubEvents([]);
    setEventData(null);
    try {
      const eventDocRef = doc(db, "events", eventId);
      const eventDocSnap = await getDoc(eventDocRef);
      if (!eventDocSnap.exists()) {
        throw new Error(`Event not found: ${eventId}`);
      }
      const fetchedEventData = {
        id: eventDocSnap.id,
        ...eventDocSnap.data(),
      } as EventData;
      const isAdmin = fetchedEventData.adminId === currentUser.uid;
      const isParticipant = (fetchedEventData.participantIds ?? []).includes(
        currentUser.uid
      );
      if (!isAdmin && !isParticipant) {
        setAccessDenied(true);
        return;
      }
      setEventData(fetchedEventData);
      if (fetchedEventData.participantIds?.length > 0) {
        const usersCollectionRef = collection(db, "users");
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
          snapshot.docs.map((d) => {
            const data = d.data();
            return {
              uid: d.id,
              displayName: data.displayName || "N/A",
              email: data.email || "",
              role: data.role || "participant",
              teamId: data.teamId || null,
            } as ParticipantProfile;
          })
        );
        setParticipants(fetchedParticipants);
      } else {
        setParticipants([]);
      }
      const teamsCollectionRef = collection(db, "teams");
      const teamsQuery = query(
        teamsCollectionRef,
        where("eventId", "==", eventId)
      );
      const teamsSnapshot = await getDocs(teamsQuery);
      const fetchedTeams = teamsSnapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as TeamData)
      );
      setTeams(fetchedTeams);
      const subEventsQuery = query(
        collection(db, "subEvents"),
        where("eventId", "==", eventId)
      );
      const subEventsSnapshot = await getDocs(subEventsQuery);
      const fetchedSubEvents = subEventsSnapshot.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "Unnamed",
      }));
      setSubEvents(fetchedSubEvents);
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setError(`Load failed: ${err.message}`);
      setEventData(null);
    } finally {
      setLoading(false);
    }
  }, [eventId, currentUser]);

  useEffect(() => {
    if (currentUser && eventId) {
      fetchEventDetails();
    } else if (!currentUser) {
      setLoading(false);
      setError("Auth required.");
      setEventData(null);
    }
  }, [currentUser, eventId, fetchEventDetails]);

  // --- Handlers ---
  const handleInvite = async (e: React.FormEvent) => {
    /* ... keep existing handleInvite logic ... */
    e.preventDefault();
    if (!inviteEmail.trim() || !eventData || !currentUser) {
      setInviteError("Data missing.");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(inviteEmail)) {
      setInviteError("Invalid email.");
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
      setInviteSuccess(`Invited ${emailToInvite}!`);
      setInviteEmail("");
    } catch (err: any) {
      console.error("Invite Error:", err);
      setInviteError(err.message || "Invite failed.");
    } finally {
      setIsInviting(false);
    }
  };
  const handleCreateSubEvent = async (e: React.FormEvent) => {
    /* ... keep existing handleCreateSubEvent logic ... */
    e.preventDefault();
    if (
      !eventData ||
      !subEventName.trim() ||
      !subEventDescription.trim() ||
      !currentUser ||
      currentUser.uid !== eventData.adminId
    ) {
      setSubEventError("Name/Desc required & Admin only.");
      return;
    }
    setSubEventLoading(true);
    setSubEventError(null);
    try {
      await addDoc(collection(db, "subEvents"), {
        eventId: eventData.id,
        name: subEventName.trim(),
        description: subEventDescription.trim(),
        assignedParticipants: {},
        manualAssignments: [],
        status: "upcoming",
        createdAt: serverTimestamp(),
      });
      setSubEventName("");
      setSubEventDescription("");
      const q = query(
        collection(db, "subEvents"),
        where("eventId", "==", eventId)
      );
      const snap = await getDocs(q);
      const fetched = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || "Unnamed",
      }));
      setSubEvents(fetched);
    } catch (err: any) {
      console.error("Sub-Event Create Error:", err);
      setSubEventError(`Create failed: ${err.message}`);
    } finally {
      setSubEventLoading(false);
    }
  };
  const handleMakeCaptain = async (participant: ParticipantProfile) => {
    /* ... keep existing handleMakeCaptain logic ... */
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length >= eventData.numberOfTeams) {
      setError(`Max teams (${eventData.numberOfTeams}) reached.`);
      return;
    }
    if (participant.role !== "participant") {
      setError(`${participant.displayName} not assignable.`);
      return;
    }
    setActionLoading(true);
    setError(null);
    const batch = writeBatch(db);
    const userRef = doc(db, "users", participant.uid);
    const newTeamRef = doc(collection(db, "teams"));
    const eventRef = doc(db, "events", eventData.id);
    try {
      const nums = teams.map((t) =>
        parseInt(t.name.match(/\d+$/)?.[0] || "0", 10)
      );
      const nextNum = Math.max(0, ...nums) + 1;
      batch.set(newTeamRef, {
        eventId: eventData.id,
        name: `Team ${nextNum}`,
        captainId: participant.uid,
        memberIds: [participant.uid],
        createdAt: serverTimestamp(),
      });
      batch.update(userRef, { role: "captain", teamId: newTeamRef.id });
      batch.update(eventRef, {
        availableForDraftIds: arrayRemove(participant.uid),
      });
      await batch.commit();
      console.log(`${participant.displayName} is Captain of Team ${nextNum}`);
      fetchEventDetails();
    } catch (err: any) {
      console.error("Make Captain Error:", err);
      setError(`Make captain failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };
  const handleStartDraft = async () => {
    /* ... keep existing handleStartDraft logic ... */
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (teams.length !== eventData.numberOfTeams) {
      setError(`Need ${eventData.numberOfTeams} teams, have ${teams.length}.`);
      return;
    }
    if (["drafting", "active", "completed"].includes(eventData.status)) {
      setError(`Status '${eventData.status}' prevents starting draft.`);
      return;
    }
    if ((eventData.availableForDraftIds ?? []).length === 0) {
      setError("No participants available.");
      return;
    }
    setActionLoading(true);
    setError(null);
    const draftRef = doc(db, "drafts", eventId);
    const eventRef = doc(db, "events", eventData.id);
    const teamIds = teams.map((t) => t.id);
    const shuffle = (a: string[]) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const order = shuffle([...teamIds]);
    try {
      await runTransaction(db, async (t) => {
        const snap = await t.get(eventRef);
        if (!snap.exists()) throw new Error("Event gone.");
        const data = snap.data();
        if (
          !data ||
          ![
            "setup",
            "inviting",
            "assigningCaptains",
            "active",
            "open",
          ].includes(data.status)
        )
          throw new Error(`Status (${data?.status}) prevents draft.`);
        t.set(draftRef, {
          eventId: eventData.id,
          status: "active",
          pickOrder: order,
          currentPickIndex: 0,
          roundNumber: 1,
          totalPicksMade: 0,
          lastPickTimestamp: serverTimestamp(),
        });
        t.update(eventRef, { status: "drafting" });
      });
      console.log("Draft started!");
      fetchEventDetails();
    } catch (err: any) {
      console.error("Start Draft Error:", err);
      setError(`Start draft failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };
  const handleDeleteEvent = async () => {
    /* ... keep existing handleDeleteEvent logic ... */
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission denied.");
      return;
    }
    const conf = window.confirm(
      `DELETE event "${eventData.name}" permanently?`
    );
    if (!conf) return;
    setIsDeleting(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      const eventRef = doc(db, "events", eventId);
      const draftRef = doc(db, "drafts", eventId);
      const relatedQueries = [
        query(collection(db, "invites"), where("eventId", "==", eventId)),
        query(collection(db, "teams"), where("eventId", "==", eventId)),
        query(collection(db, "subEvents"), where("eventId", "==", eventId)),
        query(collection(db, "scores"), where("eventId", "==", eventId)),
      ];
      const snapshots = await Promise.all(
        relatedQueries.map((q) => getDocs(q))
      );
      snapshots.forEach((snap) => snap.forEach((d) => batch.delete(d.ref)));
      const draftSnap = await getDoc(draftRef);
      if (draftSnap.exists()) batch.delete(draftRef);
      batch.delete(eventRef);
      await batch.commit();
      console.log(`Event ${eventData.name} deleted.`);
      alert("Event deleted!");
      router.push("/dashboard");
    } catch (err: any) {
      console.error("Delete Event Error:", err);
      setError(`Delete failed: ${err.message}`);
      setIsDeleting(false);
    }
  };
  const handleActivateEvent = async () => {
    /* ... keep existing handleActivateEvent logic ... */
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (
      ["active", "open", "drafting", "completed"].includes(eventData.status)
    ) {
      setError(`Already active/completed.`);
      return;
    }
    setActionLoading(true);
    setError(null);
    const eventRef = doc(db, "events", eventData.id);
    try {
      await updateDoc(eventRef, { status: "active" });
      console.log("Event activated.");
      fetchEventDetails();
    } catch (err: any) {
      console.error("Activate Error:", err);
      setError(`Activation failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };
  const handleRemoveCaptain = async (participant: ParticipantProfile) => {
    /* ... keep existing handleRemoveCaptain logic ... */
    if (
      !eventData ||
      !currentUser ||
      currentUser.uid !== eventData.adminId ||
      participant.role !== "captain" ||
      !participant.teamId
    ) {
      setError("Invalid request.");
      return;
    }
    const conf = window.confirm(
      `Remove ${participant.displayName} as captain and delete their team?`
    );
    if (!conf) return;
    setParticipantActionLoading(participant.uid);
    setError(null);
    const batch = writeBatch(db);
    const userRef = doc(db, "users", participant.uid);
    const teamRef = doc(db, "teams", participant.teamId);
    const eventRef = doc(db, "events", eventData.id);
    try {
      batch.update(userRef, { role: "participant", teamId: null });
      batch.delete(teamRef);
      if (!["drafting", "completed"].includes(eventData.status)) {
        batch.update(eventRef, {
          availableForDraftIds: arrayUnion(participant.uid),
        });
      }
      await batch.commit();
      console.log(`${participant.displayName} removed as captain.`);
      fetchEventDetails();
    } catch (err: any) {
      console.error("Remove Captain Error:", err);
      setError(`Remove captain failed: ${err.message}`);
    } finally {
      setParticipantActionLoading(null);
    }
  };
  const handleRemoveParticipant = async (participant: ParticipantProfile) => {
    /* ... keep existing handleRemoveParticipant logic ... */
    if (!eventData || !currentUser || currentUser.uid !== eventData.adminId) {
      setError("Permission Denied.");
      return;
    }
    if (participant.uid === eventData.adminId) {
      setError("Admin cannot be removed.");
      return;
    }
    const conf = window.confirm(
      `Remove ${participant.displayName} from event?`
    );
    if (!conf) return;
    setParticipantActionLoading(participant.uid);
    setError(null);
    const batch = writeBatch(db);
    const userRef = doc(db, "users", participant.uid);
    const eventRef = doc(db, "events", eventData.id);
    try {
      batch.update(userRef, { currentEventId: null, teamId: null });
      batch.update(eventRef, {
        participantIds: arrayRemove(participant.uid),
        availableForDraftIds: arrayRemove(participant.uid),
        participantEmails: arrayRemove(participant.email),
      });
      if (participant.teamId) {
        batch.update(doc(db, "teams", participant.teamId), {
          memberIds: arrayRemove(participant.uid),
        });
      }
      if (participant.email) {
        const q = query(
          collection(db, "invites"),
          where("eventId", "==", eventId),
          where("recipientEmail", "==", participant.email)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => batch.delete(d.ref));
      }
      await batch.commit();
      console.log(`${participant.displayName} removed.`);
      fetchEventDetails();
    } catch (err: any) {
      console.error("Remove Ptpt Error:", err);
      setError(`Remove failed: ${err.message}`);
    } finally {
      setParticipantActionLoading(null);
    }
  };

  // --- *** ADDED Score Handlers *** ---
  const handleSubEventSelectionForScoring = async (subEventId: string) => {
    setSelectedSubEventIdForScoring(subEventId);
    setScoreSubmitError(null);
    setScoresForSelectedSubEvent([]); // Clear previous inputs

    if (!subEventId || teams.length === 0) {
      return; // Nothing to score or no teams
    }

    setIsSubmittingScores(true); // Use this as loading indicator for score fetch
    try {
      // Fetch existing scores for this sub-event and event
      const scoresQuery = query(
        collection(db, "scores"),
        where("eventId", "==", eventId),
        where("subEventId", "==", subEventId)
      );
      const scoreSnapshots = await getDocs(scoresQuery);
      const existingScoresMap = new Map<
        string,
        { points: number; id: string }
      >();
      scoreSnapshots.forEach((doc) => {
        const data = doc.data();
        // Ensure points is stored as a number before adding to map
        if (typeof data.points === "number") {
          existingScoresMap.set(data.teamId, {
            points: data.points,
            id: doc.id,
          });
        } else {
          console.warn(
            `Invalid points data type found for score ${doc.id}, team ${data.teamId}`
          );
        }
      });

      // Initialize state based on teams, merging existing scores using the UPDATED interface
      const initialScores: ScoreInput[] = teams.map((team) => {
        const existing = existingScoresMap.get(team.id);
        return {
          teamId: team.id,
          teamName: team.name, // Store team name
          originalPoints: existing?.points ?? null, // Store original score (number or null)
          scoreDocId: existing?.id ?? null, // Store existing doc ID (string or null)
          currentPoints: existing?.points?.toString() ?? "", // Set input value (string)
        };
      });
      setScoresForSelectedSubEvent(initialScores);
    } catch (err: any) {
      console.error("Error fetching existing scores:", err);
      setScoreSubmitError(`Failed to load scores: ${err.message}`);
      // Reset state correctly on error
      setScoresForSelectedSubEvent(
        teams.map((t) => ({
          teamId: t.id,
          teamName: t.name,
          originalPoints: null,
          scoreDocId: null,
          currentPoints: "",
        }))
      );
    } finally {
      setIsSubmittingScores(false); // Finished fetching/initializing
    }
  };

  const handleScoreChange = (teamId: string, value: string) => {
    if (value === "" || value === "-" || /^-?[0-9]*$/.test(value)) {
      setScoresForSelectedSubEvent((prevScores) =>
        prevScores.map((score) =>
          score.teamId === teamId ? { ...score, points: value } : score
        )
      );
    }
  };

  const handleSubmitScores = async (e: React.FormEvent) => {
    e.preventDefault();
    // ... (initial checks remain the same) ...
    if (
      !selectedSubEventIdForScoring ||
      scoresForSelectedSubEvent.length === 0 ||
      !currentUser ||
      currentUser.role !== "admin" ||
      isSubmittingScores ||
      !eventData
    ) {
      setScoreSubmitError("Select sub-event & be admin.");
      return;
    }
    const subEvent = subEvents.find(
      (se) => se.id === selectedSubEventIdForScoring
    );
    if (!subEvent) {
      setScoreSubmitError("Sub-event not found.");
      return;
    }

    setIsSubmittingScores(true);
    setScoreSubmitError(null);
    const batch = writeBatch(db);
    const scoresCol = collection(db, "scores");
    let changesMade = false;

    try {
      // Use a for...of loop to allow async operations inside if needed (though not strictly necessary here)
      for (const scoreInput of scoresForSelectedSubEvent) {
        // Use 'currentPoints' for the value from the input field
        const pointsStr = scoreInput.currentPoints.trim();
        // Determine the new points as a number or null (for deletion)
        const newPointsNum = pointsStr === "" ? null : parseInt(pointsStr, 10);

        // Validate input if it's not empty
        if (pointsStr !== "" && isNaN(newPointsNum!)) {
          throw new Error(
            `Invalid score '${pointsStr}' for ${scoreInput.teamName}. Enter numbers only.`
          );
        }

        // Compare the *numeric or null* new value with the *numeric or null* original value
        if (newPointsNum !== scoreInput.originalPoints) {
          changesMade = true; // Mark that at least one change occurred

          // Use 'scoreDocId' to know if we update/delete or create
          if (scoreInput.scoreDocId && newPointsNum !== null) {
            // --- UPDATE ---
            batch.update(doc(db, "scores", scoreInput.scoreDocId), {
              points: newPointsNum, // Update points field
            });
          } else if (scoreInput.scoreDocId && newPointsNum === null) {
            // --- DELETE ---
            batch.delete(doc(db, "scores", scoreInput.scoreDocId));
          } else if (!scoreInput.scoreDocId && newPointsNum !== null) {
            // --- CREATE ---
            const newScoreRef = doc(scoresCol); // Auto-ID
            batch.set(newScoreRef, {
              eventId: eventId,
              subEventId: selectedSubEventIdForScoring,
              teamId: scoreInput.teamId,
              points: newPointsNum, // The new number
              assignedBy: currentUser.uid,
              assignedAt: serverTimestamp(),
              subEventName: subEvent.name,
              teamName: scoreInput.teamName, // Use stored team name
            });
          }
          // Case: !scoreDocId && newPointsNum === null (No original, input empty) -> Do nothing
        }
      } // End loop

      if (!changesMade) {
        setScoreSubmitError("No changes made to scores."); // Set error instead of alert
        setIsSubmittingScores(false);
        return;
      }

      // ... (Optional sub-event status update) ...

      await batch.commit();
      alert(`Scores updated for ${subEvent.name}!`);
      // Refetch scores AFTER commit to update originalPoints in state
      handleSubEventSelectionForScoring(selectedSubEventIdForScoring);
    } catch (err: any) {
      console.error("Error submitting scores:", err);
      setScoreSubmitError(`Update failed: ${err.message}`);
    } finally {
      setIsSubmittingScores(false);
    }
  };
  // --- *** END ADDED Score Handlers *** ---

  // --- Render Logic ---
  if (loading) return <div className="loading">Loading...</div>;
  if (accessDenied) return <div className="error">Access Denied.</div>;
  if (
    error &&
    !isDeleting &&
    !actionLoading &&
    !participantActionLoading &&
    !isSubmittingScores
  )
    return <div className="error">{error}</div>;
  if (!eventData)
    return (
      <div className="loading">
        {isDeleting ? "Deleting..." : "Event data not available."}
      </div>
    );

  const isAdmin = currentUser?.uid === eventData.adminId;
  const isEventCompleted = eventData.status === "completed";
  const canInvite = !isEventCompleted;
  const canManageCaptains = !isEventCompleted;
  const canCreateSubEvents = !isEventCompleted;
  const canActivateEvent =
    !isEventCompleted &&
    !["active", "open", "drafting"].includes(eventData.status);
  const canStartDraft =
    !isEventCompleted &&
    eventData.status !== "drafting" &&
    teams.length === eventData.numberOfTeams &&
    (eventData.availableForDraftIds ?? []).length > 0;
  const showDraftLink = ["drafting", "active", "open"].includes(
    eventData.status
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Event Info Section */}
      <section className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
        {/* --- RESTORED Event Info JSX --- */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">
            {eventData.name}
          </h1>
          <div className="flex-shrink-0 space-x-3 text-sm">
            {showDraftLink && (
              <Link
                href={`/event/${eventId}/draft`}
                className="font-medium text-indigo-600 hover:text-indigo-800"
              >
                View Draft
              </Link>
            )}
            <Link
              href={`/event/${eventId}/leaderboard`}
              className="font-medium text-indigo-600 hover:text-indigo-800"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm border-t border-gray-200 pt-4">
          <div>
            <p className="text-slate-500">Status</p>
            <p className={`font-semibold`}>{eventData.status}</p>
          </div>
          <div>
            <p className="text-slate-500">Required Teams</p>
            <p className="font-semibold text-slate-700">
              {eventData.numberOfTeams}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Created Teams</p>
            <p className="font-semibold text-slate-700">{teams.length}</p>
          </div>
          <div>
            <p className="text-slate-500">Participants</p>
            <p className="font-semibold text-slate-700">
              {participants.length}
            </p>
          </div>
        </div>
      </section>

      {/* Activate Event Button */}
      {isAdmin && canActivateEvent && (
        <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
          {/* --- RESTORED Activate Event JSX --- */}
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            Activate Event
          </h2>
          <p className="text-sm text-slate-600 mb-3">
            Manually activate the event to allow activities.
          </p>
          <button
            onClick={handleActivateEvent}
            disabled={actionLoading}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:bg-gray-400 disabled:opacity-70"
          >
            {actionLoading ? "Activating..." : "Activate Event"}
          </button>
          {error && actionLoading && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </section>
      )}

      {/* Invitation Section */}
      {isAdmin && canInvite && (
        <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
          {/* --- RESTORED Invitation JSX --- */}
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            Invite Participants
          </h2>
          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label
                htmlFor="inviteEmail"
                className="block text-sm font-medium text-slate-700 mb-1"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900"
                placeholder="participant@example.com"
              />
            </div>
            {inviteError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded-md">
                {inviteError}
              </p>
            )}
            {inviteSuccess && (
              <p className="text-sm text-green-600 bg-green-50 p-2 rounded-md">
                {inviteSuccess}
              </p>
            )}
            <button
              type="submit"
              disabled={isInviting || !inviteEmail.trim()}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isInviting ? "Sending..." : "Send Invitation"}
            </button>
          </form>
        </section>
      )}

      {/* Captain Management Section */}
      {isAdmin && canManageCaptains && (
        <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
          {/* --- RESTORED Captain Management JSX --- */}
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            Manage Captains & Teams ({teams.length} / {eventData.numberOfTeams})
          </h2>
          {teams.length > 0 && (
            <div className="mb-4 border-b pb-4">
              <h3 className="text-md font-medium text-slate-700 mb-2">
                Current Teams
              </h3>
              <ul className="divide-y divide-gray-200">
                {teams.map((team) => {
                  const captainProfile = participants.find(
                    (p) => p.uid === team.captainId
                  );
                  if (!captainProfile) return null;
                  return (
                    <li
                      key={team.id}
                      className="py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {team.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          Captain: {captainProfile.displayName}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveCaptain(captainProfile)}
                        disabled={
                          participantActionLoading === captainProfile.uid
                        }
                        className="px-2.5 py-1.5 border border-red-300 text-xs font-medium rounded shadow-sm text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-wait mt-1 sm:mt-0 self-start sm:self-center"
                      >
                        {participantActionLoading === captainProfile.uid
                          ? "..."
                          : "Remove Captain & Team"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <h3 className="text-md font-medium text-slate-700 mb-2">
            Assign New Captain
          </h3>
          {participants.filter((p) => p.role === "participant").length > 0 ? (
            <ul className="divide-y divide-gray-200">
              {participants
                .filter((p) => p.role === "participant")
                .map((p) => (
                  <li
                    key={p.uid}
                    className="py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {p.displayName}
                      </p>
                      <p className="text-xs text-slate-500">Role: {p.role}</p>
                    </div>
                    {teams.length < eventData.numberOfTeams ? (
                      <button
                        onClick={() => handleMakeCaptain(p)}
                        disabled={
                          actionLoading || participantActionLoading === p.uid
                        }
                        className="px-2.5 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-gray-400 disabled:opacity-70"
                      >
                        {actionLoading || participantActionLoading === p.uid
                          ? "..."
                          : "Make Captain"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 italic">
                        Max teams reached
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 italic">
              No available participants to assign.
            </p>
          )}
          {error && (actionLoading || participantActionLoading) && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </section>
      )}

      {/* Draft Control Section */}
      {isAdmin && !isEventCompleted && (
        <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
          {/* --- RESTORED Draft Control JSX --- */}
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            Draft Control
          </h2>
          <div className="space-y-3">
            {eventData.status === "drafting" && (
              <p className="text-sm font-medium text-yellow-700 bg-yellow-50 p-2 rounded-md">
                Draft is in progress.
              </p>
            )}
            {canStartDraft ? (
              <button
                onClick={handleStartDraft}
                disabled={actionLoading}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:opacity-70"
              >
                {actionLoading ? "Starting..." : "Start Draft"}
              </button>
            ) : (
              eventData.status !== "drafting" && (
                <p className="text-sm text-slate-500 italic">
                  Draft cannot be started yet.
                </p>
              )
            )}
            {showDraftLink && (
              <Link
                href={`/event/${eventId}/draft`}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-slate-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ml-3"
              >
                {" "}
                Go to Draft Page{" "}
              </Link>
            )}
            {error && actionLoading && (
              <p className="mt-3 text-sm text-red-600">{error}</p>
            )}
          </div>
        </section>
      )}

      {/* Sub-Events Section */}
      <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
        {/* --- RESTORED Sub-Events JSX --- */}
        <h2 className="text-xl font-semibold text-slate-800 mb-5">
          Sub-Events
        </h2>
        {isAdmin && canCreateSubEvents && (
          <form
            onSubmit={handleCreateSubEvent}
            className="mb-6 pb-6 border-b border-gray-200 space-y-4"
          >
            <h3 className="text-lg font-medium text-slate-900">
              Create New Sub-Event
            </h3>
            <div>
              <label
                htmlFor="subEventName"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Name:
              </label>
              <input
                type="text"
                id="subEventName"
                value={subEventName}
                onChange={(e) => setSubEventName(e.target.value)}
                required
                className="w-full px-3 py-2 border text-slate-700 border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="e.g., Kickoff Challenge"
              />
            </div>
            <div>
              <label
                htmlFor="subEventDescription"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Description:
              </label>
              <textarea
                id="subEventDescription"
                value={subEventDescription}
                onChange={(e) => setSubEventDescription(e.target.value)}
                rows={3}
                required
                className="w-full px-3 py-2 border text-slate-700 border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Enter details..."
              />
            </div>
            {subEventError && (
              <p className="text-sm text-red-600">{subEventError}</p>
            )}
            <button
              type="submit"
              disabled={
                subEventLoading ||
                !subEventName.trim() ||
                !subEventDescription.trim()
              }
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 disabled:bg-gray-400 disabled:opacity-70"
            >
              {subEventLoading ? "Creating..." : "Create Sub-Event"}
            </button>
          </form>
        )}
        <h3 className="text-lg font-medium text-slate-900 mb-3">
          Existing Sub-Events ({subEvents.length})
        </h3>
        {subEvents.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {subEvents.map((sub) => (
              <li
                key={sub.id}
                className="py-3 flex justify-between items-center"
              >
                <span className="text-sm font-medium text-slate-800">
                  {sub.name}
                </span>
                <Link
                  href={`/event/${eventId}/sub-event/${sub.id}`}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Manage / Assign →
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 italic">
            No sub-events created yet.
          </p>
        )}
      </section>

      {/* --- Score Entry Section (KEEP AS IS) --- */}
      {isAdmin &&
        teams.length > 0 &&
        subEvents.length > 0 &&
        !isEventCompleted && (
          <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
            <h2 className="text-xl font-semibold text-slate-800 mb-4">
              Enter Scores by Sub-Event
            </h2>
            <form onSubmit={handleSubmitScores} className="space-y-4">
              {/* Sub-Event Selector */}
              <div className="mb-4">
                <label
                  htmlFor="subEventSelect"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Select Sub-Event:
                </label>
                <select
                  id="subEventSelect"
                  value={selectedSubEventIdForScoring}
                  onChange={(e) =>
                    handleSubEventSelectionForScoring(e.target.value)
                  }
                  required
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-slate-900"
                >
                  <option value="" disabled>
                    -- Select --
                  </option>
                  {subEvents.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Score Inputs (Conditionally Rendered) */}
              {selectedSubEventIdForScoring && (
                <div className="space-y-3 pt-4 border-t border-gray-200">
                  <h3 className="text-lg font-medium text-slate-900">
                    Scores for:{" "}
                    {subEvents.find(
                      (s) => s.id === selectedSubEventIdForScoring
                    )?.name || ""}
                  </h3>
                  <p className="text-xs text-slate-500 italic mb-3">
                    Enter points. Leave blank to remove score.
                  </p>
                  {scoresForSelectedSubEvent.map((scoreInput) => {
                    const team = teams.find((t) => t.id === scoreInput.teamId);
                    if (!team) return null;
                    return (
                      <div
                        key={scoreInput.teamId}
                        className="flex flex-col sm:flex-row sm:items-center sm:space-x-3"
                      >
                        <label
                          htmlFor={`score-${scoreInput.teamId}`}
                          className="w-full sm:w-1/3 font-medium text-sm text-slate-700 mb-1 sm:mb-0 shrink-0"
                        >
                          {team.name}:
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="-?[0-9]*"
                          id={`score-${scoreInput.teamId}`}
                          // Bind value to currentPoints
                          value={scoreInput.currentPoints}
                          onChange={(e) =>
                            handleScoreChange(scoreInput.teamId, e.target.value)
                          }
                          // Use originalPoints in placeholder
                          placeholder={
                            scoreInput.originalPoints !== null
                              ? `Current: ${scoreInput.originalPoints}`
                              : "Points"
                          }
                          className="w-full sm:w-2/3 px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-slate-900"
                        />
                      </div>
                    );
                  })}
                  {scoreSubmitError && (
                    <p className="text-sm text-red-600 bg-red-50 p-2 rounded-md">
                      {scoreSubmitError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isSubmittingScores}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:opacity-70"
                  >
                    {isSubmittingScores ? "Saving..." : "Save / Update Scores"}
                  </button>
                </div>
              )}
              {!selectedSubEventIdForScoring && (
                <p className="text-sm text-slate-500 italic">
                  Select a sub-event above.
                </p>
              )}
            </form>
          </section>
        )}
      {isAdmin &&
        (teams.length === 0 || subEvents.length === 0) &&
        !isEventCompleted && (
          <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700 shadow-md">
            {" "}
            Cannot enter scores yet.
          </div>
        )}

      {/* --- Participant List Section (RESTORED JSX) --- */}
      <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">
          Participants ({participants.length})
        </h2>
        {participants.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {participants.map((p) => (
              <li
                key={p.uid}
                className="py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {p.displayName} {p.uid === currentUser?.uid ? "(You)" : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.role}{" "}
                    {p.teamId &&
                      `- Team: ${
                        teams.find((t) => t.id === p.teamId)?.name || "N/A"
                      }`}
                  </p>
                </div>
                {isAdmin && !isEventCompleted && p.uid !== currentUser?.uid && (
                  <button
                    onClick={() => handleRemoveParticipant(p)}
                    disabled={participantActionLoading === p.uid}
                    className="px-2.5 py-1.5 border border-red-300 text-xs font-medium rounded shadow-sm text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-wait mt-1 sm:mt-0 self-start sm:self-center"
                  >
                    {participantActionLoading === p.uid
                      ? "..."
                      : "Remove Participant"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 italic">
            No participants have joined yet.
          </p>
        )}
        {error && participantActionLoading && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </section>

      {/* --- Team List Section (RESTORED JSX) --- */}
      <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
        <h2 className="text-xl font-semibold text-slate-800 mb-4">
          Teams ({teams.length})
        </h2>
        {teams.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {teams.map((t) => (
              <li key={t.id} className="py-2">
                <p className="text-sm font-medium text-slate-900">{t.name}</p>
                <p className="text-xs text-slate-500">
                  Captain:{" "}
                  {participants.find((p) => p.uid === t.captainId)
                    ?.displayName || "N/A"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 italic">No teams created yet.</p>
        )}
      </section>

      {/* --- Delete Event Section (RESTORED JSX) --- */}
      {isAdmin && (
        <section className="mt-10 p-6 bg-red-50 border border-red-200 rounded-lg shadow-sm">
          <h2 className="text-xl font-semibold text-red-800 mb-3">
            Danger Zone
          </h2>
          <p className="text-sm text-red-700 mb-4">
            Delete event permanently? This cannot be undone.
          </p>
          {error && isDeleting && (
            <p className="text-sm font-medium text-red-600 bg-red-100 p-2 rounded-md mb-3">
              {error}
            </p>
          )}
          <button
            onClick={handleDeleteEvent}
            disabled={isDeleting}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? "Deleting..." : "Delete Event Permanently"}
          </button>
        </section>
      )}
    </div>
  );
}
