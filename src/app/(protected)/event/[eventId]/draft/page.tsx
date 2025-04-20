// src/app/(protected)/event/[eventId]/draft/page.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import Link from "next/link";
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  arrayRemove,
  arrayUnion,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  documentId,
  Unsubscribe,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";

interface DraftData {
  eventId: string;
  status: "active" | "completed";
  pickOrder: string[]; // Array of Team IDs
  currentPickIndex: number;
  roundNumber: number;
  totalPicksMade: number;
  lastPickTimestamp: Timestamp;
}

interface EventData {
  id: string;
  name: string;
  status: string;
  availableForDraftIds: string[];
  numberOfTeams: number;
}

interface TeamData {
  id: string;
  name: string;
  captainId: string;
  memberIds: string[];
}

interface UserProfile {
  // Reusing from manage page - consider a shared types file
  uid: string;
  displayName: string;
  role: string;
  teamId?: string | null;
}

export default function DraftPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;

  const [draftData, setDraftData] = useState<DraftData | null>(null);
  const [eventData, setEventData] = useState<EventData | null>(null);
  const [teams, setTeams] = useState<Map<string, TeamData>>(new Map()); // Map for easy lookup by ID
  const [availablePlayers, setAvailablePlayers] = useState<UserProfile[]>([]); // Full profiles
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false); // Loading state for pick action

  // --- Fetch initial data and set up listeners ---
  useEffect(() => {
    if (!eventId || !currentUser) return;
    setLoading(true);
    let draftUnsubscribe: Unsubscribe | null = null;
    let eventUnsubscribe: Unsubscribe | null = null;
    let initialDataFetched = false;

    const setupListeners = async () => {
      try {
        // Fetch initial team data once
        const teamsQuery = query(
          collection(db, "teams"),
          where("eventId", "==", eventId)
        );
        const teamSnapshots = await getDocs(teamsQuery);
        const fetchedTeams = new Map<string, TeamData>();
        teamSnapshots.forEach((doc) => {
          fetchedTeams.set(doc.id, { id: doc.id, ...doc.data() } as TeamData);
        });
        setTeams(fetchedTeams);

        // Listener for Draft document
        const draftRef = doc(db, "drafts", eventId);
        draftUnsubscribe = onSnapshot(
          draftRef,
          (docSnap) => {
            if (docSnap.exists()) {
              setDraftData(docSnap.data() as DraftData);
              // Update loading state after first successful fetch of draft data
              if (!initialDataFetched) setLoading(false);
              initialDataFetched = true; // Mark initial fetch complete
            } else {
              setError("Draft data not found. Has the draft been started?");
              setDraftData(null);
              setLoading(false);
            }
          },
          (err) => {
            console.error("Error listening to draft data:", err);
            setError("Failed to load draft data in real-time.");
            setLoading(false);
          }
        );

        // Listener for Event document (specifically for available players)
        const eventRef = doc(db, "events", eventId);
        eventUnsubscribe = onSnapshot(
          eventRef,
          async (docSnap) => {
            if (docSnap.exists()) {
              const currentEventData = {
                id: docSnap.id,
                ...docSnap.data(),
              } as EventData;
              setEventData(currentEventData);

              // Fetch details for available players whenever the list changes
              const playerIds = currentEventData.availableForDraftIds || [];
              if (playerIds.length > 0) {
                // Exclude captains from the 'available' list for picking
                const captainIds = Array.from(fetchedTeams.values()).map(
                  (t) => t.captainId
                );
                const draftablePlayerIds = playerIds.filter(
                  (id) => !captainIds.includes(id)
                );

                if (draftablePlayerIds.length > 0) {
                  // Fetch user details in chunks if necessary
                  const usersQuery = query(
                    collection(db, "users"),
                    where(documentId(), "in", draftablePlayerIds.slice(0, 30))
                  ); // Handle > 30 limit
                  const usersSnapshot = await getDocs(usersQuery);
                  const fetchedPlayers = usersSnapshot.docs.map((doc) => ({
                    uid: doc.id,
                    displayName: doc.data().displayName || "N/A",
                    role: doc.data().role || "participant", // Should be participant
                    teamId: doc.data().teamId || null, // Should be null
                  })) as UserProfile[];
                  setAvailablePlayers(fetchedPlayers);
                } else {
                  setAvailablePlayers([]); // No non-captain players left
                }
              } else {
                setAvailablePlayers([]); // No players left at all
              }
            } else {
              setError("Event data not found.");
              setEventData(null);
              setAvailablePlayers([]);
            }
          },
          (err) => {
            console.error("Error listening to event data:", err);
            setError("Failed to load available players in real-time.");
          }
        );
      } catch (err: any) {
        console.error("Error fetching initial draft page data:", err);
        setError("Failed to initialize draft page. " + err.message);
        setLoading(false);
      }
    };

    setupListeners();

    // Cleanup listeners on unmount
    return () => {
      if (draftUnsubscribe) draftUnsubscribe();
      if (eventUnsubscribe) eventUnsubscribe();
    };
  }, [eventId, currentUser]);

  // --- Determine current picker ---
  const currentPickingTeamId = useMemo(() => {
    if (!draftData || draftData.status === "completed" || !draftData.pickOrder)
      return null;
    return draftData.pickOrder[draftData.currentPickIndex];
  }, [draftData]);

  const currentPickingTeam = useMemo(() => {
    if (!currentPickingTeamId || !teams) return null;
    return teams.get(currentPickingTeamId);
  }, [currentPickingTeamId, teams]);

  const isMyTurn = useMemo(() => {
    if (!currentUser || !currentPickingTeam) return false;
    return currentUser.uid === currentPickingTeam.captainId;
  }, [currentUser, currentPickingTeam]);

  // --- Handle Player Pick ---
  const handlePickPlayer = async (playerToPick: UserProfile) => {
    if (
      !currentUser ||
      !isMyTurn ||
      !draftData ||
      !eventData ||
      !currentPickingTeam ||
      isPicking ||
      draftData.status === "completed"
    ) {
      console.warn("Pick prevented:", {
        isMyTurn,
        isPicking,
        draftStatus: draftData?.status,
      });
      return;
    }

    setIsPicking(true);
    setError(null);

    const draftRef = doc(db, "drafts", eventId);
    const eventRef = doc(db, "events", eventId);
    const playerRef = doc(db, "users", playerToPick.uid);
    const teamRef = doc(db, "teams", currentPickingTeam.id);

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Read current state within transaction for consistency checks
        const freshDraftSnap = await transaction.get(draftRef);
        const freshEventSnap = await transaction.get(eventRef);
        const freshTeamSnap = await transaction.get(teamRef); // Ensure team exists

        if (
          !freshDraftSnap.exists() ||
          !freshEventSnap.exists() ||
          !freshTeamSnap.exists()
        ) {
          throw new Error("Draft, Event, or Team data missing during pick.");
        }

        const currentDraftData = freshDraftSnap.data() as DraftData;
        const currentEventData = freshEventSnap.data() as EventData;
        //const currentTeamData = freshTeamSnap.data(); // Can use if needed

        // 2. Validate the pick
        if (currentDraftData.status !== "active")
          throw new Error("Draft is not active.");
        if (
          currentDraftData.pickOrder[currentDraftData.currentPickIndex] !==
          currentPickingTeam.id
        )
          throw new Error(
            "It's not this team's turn according to latest data."
          );
        if (!currentEventData.availableForDraftIds?.includes(playerToPick.uid))
          throw new Error(
            `${playerToPick.displayName} is no longer available.`
          );

        // 3. Calculate next state
        const nextPickIndex =
          (currentDraftData.currentPickIndex + 1) %
          currentDraftData.pickOrder.length;
        const nextRoundNumber =
          nextPickIndex === 0
            ? currentDraftData.roundNumber + 1
            : currentDraftData.roundNumber;
        const nextTotalPicksMade = currentDraftData.totalPicksMade + 1;

        // Check if draft completes (e.g., all available players picked)
        // Note: availableForDraftIds includes captains initially, adjust logic if needed
        const remainingDraftablePlayers =
          currentEventData.availableForDraftIds.length - 1; // -1 for the player being picked
        const draftIsCompleting = remainingDraftablePlayers <= teams.size; // If remaining players equals number of teams (captains), draft ends? Adjust condition as needed.

        const nextDraftStatus = draftIsCompleting ? "completed" : "active";
        const nextEventStatus = draftIsCompleting ? "active" : "drafting"; // Update event status when draft completes

        // 4. Perform writes
        // Update Draft Doc
        transaction.update(draftRef, {
          currentPickIndex: nextPickIndex,
          roundNumber: nextRoundNumber,
          totalPicksMade: nextTotalPicksMade,
          status: nextDraftStatus,
          lastPickTimestamp: serverTimestamp(),
        });

        // Update Event Doc (remove player from available)
        transaction.update(eventRef, {
          availableForDraftIds: arrayRemove(playerToPick.uid),
          status: nextEventStatus, // Update event status if draft is finishing
        });

        // Update Player's User Doc (assign teamId)
        transaction.update(playerRef, {
          teamId: currentPickingTeam.id,
        });

        // Update Team Doc (add player to memberIds)
        transaction.update(teamRef, {
          memberIds: arrayUnion(playerToPick.uid),
        });
      });

      console.log(
        `${playerToPick.displayName} drafted to ${currentPickingTeam.name}`
      );
      // UI updates automatically via listeners
    } catch (err: any) {
      console.error("Error picking player:", err);
      setError(`Failed to pick player: ${err.message}`);
    } finally {
      setIsPicking(false);
    }
  };

  // --- Render Logic ---
  if (loading)
    return <div className="container mx-auto p-4">Loading draft...</div>;
  if (error)
    return <div className="container mx-auto p-4 text-red-500">{error}</div>;
  if (!draftData || !eventData)
    return (
      <div className="container mx-auto p-4">
        Draft or Event data unavailable.
      </div>
    );

  const currentPickerName = currentPickingTeam
    ? `${currentPickingTeam.name} (Captain: ${
        teams.get(currentPickingTeam.id)?.captainId === currentUser?.uid
          ? "You"
          : "..."
      })`
    : "N/A";

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-2">Draft: {eventData.name}</h1>
      <p className="mb-4 text-lg">
        Status:{" "}
        <span
          className={`font-semibold ${
            draftData.status === "completed"
              ? "text-green-600"
              : "text-yellow-600"
          }`}
        >
          {draftData.status}
        </span>
      </p>

      {draftData.status === "active" && (
        <div className="mb-6 p-4 bg-blue-100 rounded border border-blue-300">
          <p className="text-xl font-semibold">
            Round {draftData.roundNumber}, Pick {draftData.totalPicksMade + 1}
          </p>
          <p className="text-lg">
            On the clock: <span className="font-bold">{currentPickerName}</span>
            {isMyTurn && (
              <span className="text-green-700 font-bold ml-2">
                (Your Pick!)
              </span>
            )}
          </p>
        </div>
      )}
      {draftData.status === "completed" && (
        <div className="mb-6 p-4 bg-green-100 rounded border border-green-300">
          <p className="text-xl font-semibold text-green-700">
            Draft Completed!
          </p>
          <Link
            href={`/event/${eventId}/leaderboard`}
            className="text-blue-600 hover:underline"
          >
            View Teams & Leaderboard
          </Link>
        </div>
      )}

      {error && <p className="text-red-500 text-sm my-4">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Available Players */}
        <div className="md:col-span-2">
          <h2 className="text-2xl font-semibold mb-3">
            Available Players ({availablePlayers.length})
          </h2>
          {availablePlayers.length > 0 ? (
            <ul className="space-y-2">
              {availablePlayers.map((player) => (
                <li
                  key={player.uid}
                  className="flex justify-between items-center p-3 bg-white rounded shadow border"
                >
                  <span>{player.displayName}</span>
                  {isMyTurn && draftData.status === "active" && (
                    <button
                      onClick={() => handlePickPlayer(player)}
                      disabled={isPicking}
                      className="bg-green-500 hover:bg-green-700 text-white text-sm font-bold py-1 px-3 rounded disabled:bg-gray-400"
                    >
                      {isPicking ? "Picking..." : "Draft"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">
              {draftData.status === "completed"
                ? "All players drafted."
                : "No players currently available for draft."}
            </p>
          )}
        </div>

        {/* Column 2: Draft Order / Team Summary */}
        <div>
          <h2 className="text-2xl font-semibold mb-3">Teams & Draft Order</h2>
          <ol className="list-decimal list-inside space-y-3">
            {draftData.pickOrder.map((teamId, index) => {
              const team = teams.get(teamId);
              const isCurrentPicker =
                index === draftData.currentPickIndex &&
                draftData.status === "active";
              return (
                <li
                  key={teamId}
                  className={`p-3 rounded border ${
                    isCurrentPicker
                      ? "bg-yellow-100 border-yellow-400 font-bold"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <span className="font-semibold">
                    {team?.name || "Unknown Team"}
                  </span>
                  {/* Optionally list members or captain */}
                  {/* <p className="text-sm text-gray-600">Members: {team?.memberIds.length || 0}</p> */}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {/* Link back to Manage Event */}
      <div className="mt-8">
        <Link
          href={`/event/${eventId}/manage`}
          className="text-blue-600 hover:underline"
        >
          ← Back to Event Management
        </Link>
      </div>
    </div>
  );
}
