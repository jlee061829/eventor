// src/app/(protected)/event/[eventId]/leaderboard/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  Unsubscribe,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";

interface ScoreData {
  id: string;
  eventId: string;
  subEventId: string;
  subEventName?: string;
  teamId: string;
  teamName?: string;
  points: number;
  assignedAt: Timestamp;
}

interface TeamData {
  id: string;
  name: string;
  // Add captain name/member count if desired
}

interface LeaderboardEntry {
  teamId: string;
  teamName: string;
  totalPoints: number;
  scoresBreakdown: { subEventName: string; points: number }[]; // Optional breakdown
}

interface EventData {
  id: string;
  name: string;
  adminId?: string; // Optional: If needed for display/links
}

export default function LeaderboardPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;

  const [eventData, setEventData] = useState<EventData | null>(null);
  const [teams, setTeams] = useState<Map<string, TeamData>>(new Map()); // Use Map for quick lookup
  const [scores, setScores] = useState<ScoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Fetch initial data and set up listener ---
  useEffect(() => {
    if (!eventId || !currentUser) return;
    setLoading(true);
    let scoresUnsubscribe: Unsubscribe | null = null;

    const fetchInitialDataAndListen = async () => {
      try {
        // Fetch Event Info (once)
        const eventRef = doc(db, "events", eventId);
        const eventSnap = await getDoc(eventRef);
        if (!eventSnap.exists()) throw new Error("Event not found.");
        setEventData({ id: eventSnap.id, ...eventSnap.data() } as EventData);

        // Fetch Teams Info (once)
        const teamsQuery = query(
          collection(db, "teams"),
          where("eventId", "==", eventId)
        );
        const teamsSnapshot = await getDocs(teamsQuery);
        const fetchedTeams = new Map<string, TeamData>();
        teamsSnapshot.forEach((doc) => {
          fetchedTeams.set(doc.id, {
            id: doc.id,
            name: doc.data().name || `Team ${doc.id.substring(0, 5)}`,
          } as TeamData);
        });
        setTeams(fetchedTeams);

        // Listener for Scores
        const scoresQuery = query(
          collection(db, "scores"),
          where("eventId", "==", eventId)
        );
        scoresUnsubscribe = onSnapshot(
          scoresQuery,
          (querySnapshot) => {
            const fetchedScores: ScoreData[] = [];
            querySnapshot.forEach((doc) => {
              fetchedScores.push({ id: doc.id, ...doc.data() } as ScoreData);
            });
            setScores(fetchedScores);
            setLoading(false); // Stop loading once first scores (or empty set) arrive
            setError(null); // Clear previous errors on successful update
          },
          (err) => {
            console.error("Error listening to scores:", err);
            setError("Failed to load scores in real-time.");
            setLoading(false);
          }
        );
      } catch (err: any) {
        console.error("Error fetching leaderboard initial data:", err);
        setError("Failed to load leaderboard data. " + err.message);
        setLoading(false);
        if (err.message.startsWith("Event not found")) {
          router.push("/dashboard");
        }
      }
    };

    fetchInitialDataAndListen();

    // Cleanup listener
    return () => {
      if (scoresUnsubscribe) scoresUnsubscribe();
    };
  }, [eventId, currentUser, router]); // Added router

  // --- Calculate Leaderboard ---
  const leaderboardData = useMemo((): LeaderboardEntry[] => {
    const aggregatedScores: { [teamId: string]: LeaderboardEntry } = {};

    // Initialize entries for all teams fetched
    teams.forEach((team) => {
      aggregatedScores[team.id] = {
        teamId: team.id,
        teamName: team.name,
        totalPoints: 0,
        scoresBreakdown: [],
      };
    });

    // Aggregate points from scores
    scores.forEach((score) => {
      if (aggregatedScores[score.teamId]) {
        aggregatedScores[score.teamId].totalPoints += score.points;
        // Add to breakdown (optional)
        aggregatedScores[score.teamId].scoresBreakdown.push({
          subEventName:
            score.subEventName ||
            `SubEvent (${score.subEventId.substring(0, 5)})`,
          points: score.points,
        });
      } else {
        // This case handles scores for teams that might not be in the initial `teams` fetch
        // (e.g., if a team was deleted but scores remain). Consider how to handle this.
        console.warn(
          `Score found for unknown or deleted team ID: ${score.teamId}`
        );
      }
    });

    // Convert map to array and sort
    return Object.values(aggregatedScores).sort(
      (a, b) => b.totalPoints - a.totalPoints
    );
  }, [scores, teams]);

  // --- Render Logic ---
  if (loading)
    return <div className="container mx-auto p-4">Loading leaderboard...</div>;

  return (
    <div className="container mx-auto p-4">
      <Link
        href={`/event/${eventId}/manage`}
        className="text-blue-600 hover:underline mb-4 block"
      >
        ← Back to Event Management
      </Link>
      <h1 className="text-3xl font-bold mb-4">
        Leaderboard: {eventData?.name || "Event"}
      </h1>

      {error && (
        <p className="text-red-500 bg-red-100 p-3 rounded mb-4">{error}</p>
      )}

      {leaderboardData.length > 0 ? (
        <div className="overflow-x-auto bg-white rounded shadow-md border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Rank
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Team Name
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Total Points
                </th>
                {/* Optional: Add a column for breakdown */}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leaderboardData.map((entry, index) => (
                <tr
                  key={entry.teamId}
                  className={
                    currentUser?.teamId === entry.teamId ? "bg-blue-50" : ""
                  }
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {index + 1}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {entry.teamName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {entry.totalPoints}
                  </td>
                  {/* Optional: Render breakdown details here */}
                  {/* <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                                         {entry.scoresBreakdown.map(b => `${b.subEventName}: ${b.points}`).join(', ')}
                                     </td> */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 italic">
          No scores submitted yet, or no teams found.
        </p>
      )}
    </div>
  );
}
