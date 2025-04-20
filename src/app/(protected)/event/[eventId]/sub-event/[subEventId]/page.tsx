// src/app/(protected)/event/[eventId]/sub-event/[subEventId]/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, redirect } from "next/navigation"; // Correct import for redirect
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  documentId,
  writeBatch,
  increment,
} from "firebase/firestore";
import Link from "next/link";

interface SubEventData {
  id: string;
  eventId: string;
  name: string;
  status: "upcoming" | "active" | "completed"; // Add more statuses if needed
  assignedParticipants: { [teamId: string]: string[] }; // Map teamId -> array of userIds
  // Add other fields like description, dateTime
}

interface TeamData {
  // Reusing from manage page
  id: string;
  name: string;
  captainId: string;
  memberIds: string[];
}

interface UserProfile {
  // Reusing from manage page
  uid: string;
  displayName: string;
}

interface ScoreInput {
  teamId: string;
  points: number | string; // Use string initially for input flexibility
}

export default function SubEventPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;
  const subEventId = params.subEventId as string;

  const [subEventData, setSubEventData] = useState<SubEventData | null>(null);
  const [teamData, setTeamData] = useState<TeamData | null>(null); // Current user's team if captain
  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]); // Members of captain's team
  const [allEventTeams, setAllEventTeams] = useState<TeamData[]>([]); // For admin scoring
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]); // For captain assignment
  const [scores, setScores] = useState<ScoreInput[]>([]); // For admin score entry
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false); // For save/submit actions

  // --- Fetch Data ---
  const fetchData = useCallback(async () => {
    if (!eventId || !subEventId || !currentUser) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch Sub-Event
      const subEventRef = doc(db, "subEvents", subEventId);
      const subEventSnap = await getDoc(subEventRef);
      if (!subEventSnap.exists() || subEventSnap.data()?.eventId !== eventId) {
        throw new Error(
          "Sub-event not found or does not belong to this event."
        );
      }
      const fetchedSubEventData = {
        id: subEventSnap.id,
        ...subEventSnap.data(),
      } as SubEventData;
      setSubEventData(fetchedSubEventData);

      // Determine User Role Context (Admin, Captain, Participant)
      // Fetch all teams for admin scoring OR specific team for captain assignment
      const teamsQuery = query(
        collection(db, "teams"),
        where("eventId", "==", eventId)
      );
      const teamsSnapshot = await getDocs(teamsQuery);
      const fetchedTeams = teamsSnapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as TeamData)
      );
      setAllEventTeams(fetchedTeams); // Store all teams for admin

      if (currentUser.role === "captain") {
        const myTeam = fetchedTeams.find((t) => t.id === currentUser.teamId);
        if (myTeam) {
          setTeamData(myTeam);
          // Fetch team member details
          if (myTeam.memberIds && myTeam.memberIds.length > 0) {
            const usersQuery = query(
              collection(db, "users"),
              where(documentId(), "in", myTeam.memberIds.slice(0, 30))
            ); // Handle > 30 members
            const usersSnapshot = await getDocs(usersQuery);
            const members = usersSnapshot.docs.map(
              (d) =>
                ({
                  uid: d.id,
                  displayName: d.data().displayName,
                } as UserProfile)
            );
            setTeamMembers(members);
          }
          // Initialize selection based on existing assigned participants for this team
          setSelectedPlayers(
            fetchedSubEventData.assignedParticipants?.[myTeam.id] || []
          );
        } else {
          console.warn(
            "Captain's team data not found for teamId:",
            currentUser.teamId
          );
        }
      } else if (currentUser.role === "admin") {
        // Initialize score inputs for all teams
        setScores(fetchedTeams.map((t) => ({ teamId: t.id, points: "" })));
      }
    } catch (err: any) {
      console.error("Error fetching sub-event data:", err);
      setError("Failed to load sub-event data. " + err.message);
      if (err.message.startsWith("Sub-event not found")) {
        router.push(`/event/${eventId}/manage`); // Redirect if invalid sub-event
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, subEventId, currentUser, router]); // Add router to dependencies

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Captain: Handle Player Selection ---
  const handleCheckboxChange = (memberId: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  // --- Captain: Save Player Assignments ---
  const handleSaveAssignments = async () => {
    if (
      !currentUser ||
      currentUser.role !== "captain" ||
      !teamData ||
      !subEventData ||
      isSaving
    )
      return;

    setIsSaving(true);
    setError(null);
    const subEventRef = doc(db, "subEvents", subEventId);

    try {
      // Update only the specific team's entry in the map
      const updatePath = `assignedParticipants.${teamData.id}`;
      await updateDoc(subEventRef, {
        [updatePath]: selectedPlayers,
      });
      console.log("Assignments saved successfully for team", teamData.name);
      // Optionally show a success message
    } catch (err: any) {
      console.error("Error saving assignments:", err);
      setError("Failed to save assignments. " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Admin: Handle Score Input Change ---
  const handleScoreChange = (teamId: string, value: string) => {
    setScores((prevScores) =>
      prevScores.map((score) =>
        score.teamId === teamId ? { ...score, points: value } : score
      )
    );
  };

  // --- Admin: Submit Scores ---
  const handleSubmitScores = async () => {
    if (
      !currentUser ||
      currentUser.role !== "admin" ||
      !subEventData ||
      isSaving
    )
      return;

    setIsSaving(true);
    setError(null);
    const batch = writeBatch(db);
    const scoresCollectionRef = collection(db, "scores");
    let hasValidScore = false;

    try {
      scores.forEach((scoreInput) => {
        const points = parseInt(scoreInput.points as string, 10);
        // Only save if points is a valid number (including 0)
        if (!isNaN(points)) {
          hasValidScore = true;
          const scoreDocRef = doc(scoresCollectionRef); // Auto-generate ID
          batch.set(scoreDocRef, {
            eventId: eventId,
            subEventId: subEventId,
            teamId: scoreInput.teamId,
            points: points,
            assignedBy: currentUser.uid,
            assignedAt: serverTimestamp(),
            subEventName: subEventData.name, // Store for convenience on leaderboard
            teamName:
              allEventTeams.find((t) => t.id === scoreInput.teamId)?.name ||
              "Unknown Team", // Store for convenience
          });
        } else if ((scoreInput.points as string).trim() !== "") {
          // Throw error if input is non-empty but not a number
          throw new Error(
            `Invalid score input for team ${
              allEventTeams.find((t) => t.id === scoreInput.teamId)?.name
            }: '${scoreInput.points}'`
          );
        }
      });

      if (!hasValidScore) {
        throw new Error("No valid scores entered to submit.");
      }

      // Mark sub-event as completed (optional, adjust logic as needed)
      const subEventRef = doc(db, "subEvents", subEventId);
      batch.update(subEventRef, { status: "completed" });

      await batch.commit();
      console.log("Scores submitted successfully.");
      // Optionally show success message and maybe clear form or refetch
      fetchData(); // Refetch to show updated status/scores if displayed
    } catch (err: any) {
      console.error("Error submitting scores:", err);
      setError("Failed to submit scores. " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Render Logic ---
  if (loading)
    return (
      <div className="container mx-auto p-4">Loading sub-event details...</div>
    );
  if (error)
    return <div className="container mx-auto p-4 text-red-500">{error}</div>;
  if (!subEventData)
    return (
      <div className="container mx-auto p-4">Sub-event data unavailable.</div>
    );

  const isAdmin = currentUser?.role === "admin";
  const isCaptain = currentUser?.role === "captain";
  const canAssign = isCaptain && subEventData.status === "upcoming"; // Only allow assigning before start
  const canScore = isAdmin && subEventData.status !== "completed"; // Allow scoring until marked completed

  return (
    <div className="container mx-auto p-4">
      <Link
        href={`/event/${eventId}/manage`}
        className="text-blue-600 hover:underline mb-4 block"
      >
        ← Back to Event Management
      </Link>
      <h1 className="text-3xl font-bold mb-2">
        Sub-Event: {subEventData.name}
      </h1>
      <p className="mb-6">
        Status: <span className="font-semibold">{subEventData.status}</span>
      </p>

      {error && <p className="text-red-500 text-sm my-4">{error}</p>}

      {/* Captain: Participant Assignment Section */}
      {isCaptain && teamData && (
        <div className="mb-8 p-6 bg-white rounded shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">
            Assign Your Team Members ({teamData.name})
          </h2>
          {canAssign ? (
            <>
              <p className="text-gray-600 mb-3">
                Select members who will participate in this sub-event:
              </p>
              <ul className="space-y-2 mb-4">
                {teamMembers.map((member) => (
                  <li key={member.uid}>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPlayers.includes(member.uid)}
                        onChange={() => handleCheckboxChange(member.uid)}
                        className="form-checkbox h-5 w-5 text-blue-600"
                      />
                      <span>
                        {member.displayName}{" "}
                        {member.uid === currentUser?.uid ? "(You)" : ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                onClick={handleSaveAssignments}
                disabled={isSaving}
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400"
              >
                {isSaving ? "Saving..." : "Save Assignments"}
              </button>
            </>
          ) : (
            <p className="text-gray-500 italic">
              Assignments cannot be changed (event status: {subEventData.status}
              ).
            </p>
          )}
          {/* Display currently assigned (read-only view might be useful too) */}
          <div className="mt-4 pt-4 border-t">
            <h3 className="font-semibold text-sm mb-1">
              Currently Assigned ({selectedPlayers.length}):
            </h3>
            <p className="text-sm text-gray-700">
              {selectedPlayers
                .map(
                  (id) =>
                    teamMembers.find((m) => m.uid === id)?.displayName ||
                    id.substring(0, 5)
                )
                .join(", ") || "None"}
            </p>
          </div>
        </div>
      )}

      {/* Admin: Score Entry Section */}
      {isAdmin && (
        <div className="mb-8 p-6 bg-white rounded shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold mb-4">Enter Scores</h2>
          {canScore ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitScores();
              }}
            >
              <div className="space-y-3 mb-4">
                {allEventTeams.map((team) => (
                  <div key={team.id} className="flex items-center space-x-3">
                    <label
                      htmlFor={`score-${team.id}`}
                      className="w-1/3 font-medium"
                    >
                      {team.name}:
                    </label>
                    <input
                      type="number"
                      id={`score-${team.id}`}
                      value={
                        scores.find((s) => s.teamId === team.id)?.points ?? ""
                      }
                      onChange={(e) =>
                        handleScoreChange(team.id, e.target.value)
                      }
                      placeholder="Points"
                      className="w-2/3 px-3 py-1 border rounded text-gray-700 focus:outline-none focus:ring focus:border-blue-300"
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                disabled={isSaving}
                className="bg-green-600 hover:bg-green-800 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400"
              >
                {isSaving ? "Submitting..." : "Submit Scores & Complete Event"}
              </button>
            </form>
          ) : (
            <p className="text-gray-500 italic">
              Scoring cannot be done (event status: {subEventData.status}).
            </p>
            // TODO: Display already submitted scores if any
          )}
        </div>
      )}

      {/* TODO: Display assigned participants for all teams (useful for everyone) */}
    </div>
  );
}
