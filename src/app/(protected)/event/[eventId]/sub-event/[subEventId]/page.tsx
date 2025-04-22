// src/app/(protected)/event/[eventId]/sub-event/[subEventId]/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  writeBatch, // Keep writeBatch
} from "firebase/firestore";
import Link from "next/link";

// --- Interfaces ---
interface SubEventData {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  status: "upcoming" | "active" | "completed";
  assignedParticipants: { [teamId: string]: string[] }; // Keep if captains use it
  manualAssignments?: string[]; // Keep if using this pattern elsewhere
}
interface TeamData {
  id: string;
  name: string;
  captainId: string;
  memberIds: string[];
}
interface UserProfile {
  uid: string;
  displayName: string;
}

// Interface for score input state
interface ScoreInput {
  teamId: string;
  points: string; // Use string for input, parse on submit
}

export default function SubEventPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;
  const subEventId = params.subEventId as string;

  // --- State ---
  const [subEventData, setSubEventData] = useState<SubEventData | null>(null);
  // const [teamData, setTeamData] = useState<TeamData | null>(null); // Only needed for captain view
  // const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]); // Only needed for captain view
  const [allEventTeams, setAllEventTeams] = useState<TeamData[]>([]); // Needed for admin scoring
  // const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]); // Only needed for captain view
  const [scores, setScores] = useState<ScoreInput[]>([]); // State for score inputs
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false); // Used for Submit Scores

  // --- Fetch Data ---
  const fetchData = useCallback(async () => {
    if (!eventId || !subEventId || !currentUser) {
      setLoading(false);
      setError("Missing info.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const subEventRef = doc(db, "subEvents", subEventId);
      const subEventSnap = await getDoc(subEventRef);
      if (!subEventSnap.exists() || subEventSnap.data()?.eventId !== eventId) {
        throw new Error("Sub-event not found.");
      }
      const fetchedSubEventData = {
        id: subEventSnap.id,
        ...subEventSnap.data(),
      } as SubEventData;
      setSubEventData(fetchedSubEventData);

      // Always fetch all teams for the admin scoring section
      const teamsQuery = query(
        collection(db, "teams"),
        where("eventId", "==", eventId)
      );
      const teamsSnapshot = await getDocs(teamsQuery);
      const fetchedTeams = teamsSnapshot.docs.map(
        (d) => ({ id: d.id, ...d.data() } as TeamData)
      );
      setAllEventTeams(fetchedTeams);

      // Initialize score inputs only if the user is admin
      if (currentUser.role === "admin") {
        setScores(fetchedTeams.map((t) => ({ teamId: t.id, points: "" })));
      }

      // Keep captain logic if needed for assignment feature, otherwise remove
      // if (currentUser.role === "captain" && currentUser.teamId) { ... }
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setError(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [eventId, subEventId, currentUser]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Handlers ---

  // Handler to update score input state
  const handleScoreChange = (teamId: string, value: string) => {
    // Allow empty string, optional minus sign, and numbers only
    if (value === "" || value === "-" || /^-?[0-9]*$/.test(value)) {
      setScores((prevScores) =>
        prevScores.map((score) =>
          score.teamId === teamId ? { ...score, points: value } : score
        )
      );
    }
  };

  // Handler to submit the entered scores
  const handleSubmitScores = async () => {
    if (
      !currentUser ||
      currentUser.role !== "admin" ||
      !subEventData ||
      isSaving ||
      !eventId ||
      !subEventId
    ) {
      setError("Cannot submit scores: Missing data or permissions.");
      return;
    }
    if (subEventData.status === "completed") {
      setError("Cannot submit scores: Sub-event completed.");
      return;
    }

    setIsSaving(true);
    setError(null);
    const batch = writeBatch(db);
    const scoresCollectionRef = collection(db, "scores");
    let validScoresFound = 0;

    try {
      scores.forEach((scoreInput) => {
        const pointsStr = scoreInput.points.trim();
        // Only process non-empty inputs
        if (pointsStr !== "") {
          const points = parseInt(pointsStr, 10);
          // Validate that it's a valid integer
          if (isNaN(points)) {
            throw new Error(
              `Invalid score '${pointsStr}' for team ${
                allEventTeams.find((t) => t.id === scoreInput.teamId)?.name ||
                scoreInput.teamId
              }. Enter numbers only.`
            );
          }
          validScoresFound++;
          const scoreDocRef = doc(scoresCollectionRef); // New doc for each score entry
          batch.set(scoreDocRef, {
            eventId: eventId,
            subEventId: subEventId,
            teamId: scoreInput.teamId,
            points: points, // Save the parsed number
            assignedBy: currentUser.uid,
            assignedAt: serverTimestamp(),
            subEventName: subEventData.name, // Convenience field
            teamName:
              allEventTeams.find((t) => t.id === scoreInput.teamId)?.name ||
              "Unknown Team", // Convenience field
          });
        }
      });

      if (validScoresFound === 0) {
        throw new Error("No scores entered to submit.");
      }

      // Optionally, mark sub-event as completed
      const subEventRef = doc(db, "subEvents", subEventId);
      batch.update(subEventRef, { status: "completed" });

      await batch.commit();
      console.log("Scores submitted successfully.");
      alert("Scores submitted!");
      fetchData(); // Refresh data to show completed status
    } catch (err: any) {
      console.error("Error submitting scores:", err);
      setError(`Score submission failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // --- Render Logic ---
  if (loading) return <div className="loading">Loading...</div>;
  if (error && !isSaving) return <div className="error">{error}</div>;
  if (!subEventData)
    return <div className="loading">Sub-event data unavailable.</div>;

  const isAdmin = currentUser?.role === "admin";
  const canScore = isAdmin && subEventData.status !== "completed";

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Link back & Title */}
      <Link
        href={`/event/${eventId}/manage`}
        className="text-sm font-medium text-indigo-600 hover:text-indigo-800 inline-block mb-4"
      >
        ← Back to Event Management
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-1">
        Manage Sub-Event: {subEventData.name}
      </h1>
      {subEventData.description && (
        <p className="text-base text-slate-600 mb-3">
          {subEventData.description}
        </p>
      )}
      <p className="mb-6 text-sm">
        Status: <span className="font-semibold">{subEventData.status}</span>
      </p>

      {/* Display specific saving errors here */}
      {error && isSaving && (
        <p className="text-red-500 text-sm my-4 p-3 bg-red-50 rounded">
          {error}
        </p>
      )}

      {/* --- Admin Score Entry Section --- */}
      {isAdmin && (
        <section className="p-6 bg-white rounded-lg shadow-md border border-gray-200">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            Enter Scores for "{subEventData.name}"
          </h2>
          {canScore ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitScores();
              }}
              className="space-y-4"
            >
              {allEventTeams.length > 0 ? (
                allEventTeams.map((team) => (
                  <div
                    key={team.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:space-x-3"
                  >
                    <label
                      htmlFor={`score-${team.id}`}
                      className="w-full sm:w-1/3 font-medium text-sm text-slate-700 mb-1 sm:mb-0 shrink-0"
                    >
                      {team.name}:
                    </label>
                    <input
                      type="text" // Use text to allow empty string and easier validation before parseInt
                      inputMode="numeric" // Hint for mobile keyboards
                      pattern="-?[0-9]*" // Allow empty, optional minus, digits
                      id={`score-${team.id}`}
                      value={
                        scores.find((s) => s.teamId === team.id)?.points ?? ""
                      }
                      onChange={(e) =>
                        handleScoreChange(team.id, e.target.value)
                      }
                      placeholder="Points"
                      className="w-full sm:w-2/3 px-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">
                  No teams found for this event to score.
                </p>
              )}

              {/* Submit Button */}
              {allEventTeams.length > 0 && (
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:opacity-70"
                >
                  {isSaving
                    ? "Submitting..."
                    : "Submit Scores & Complete Sub-Event"}
                </button>
              )}
            </form>
          ) : (
            <p className="text-sm text-slate-500 italic">
              Scoring is closed (Status: {subEventData.status}).
              {/* TODO: Display submitted scores here */}
            </p>
          )}
        </section>
      )}
      {/* --- End Score Entry Section --- */}

      {/* Other sections like Captain Assignment if needed */}
      {/* {isCaptain && teamData && ( <section>...</section> )} */}
    </div>
  );
}
