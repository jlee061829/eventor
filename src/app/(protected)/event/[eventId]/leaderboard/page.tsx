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
}

interface LeaderboardEntry {
  teamId: string;
  teamName: string;
  totalPoints: number;
}

interface EventData {
  id: string;
  name: string;
}

export default function LeaderboardPage() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const eventId = params.eventId as string;

  const [eventData, setEventData] = useState<EventData | null>(null);
  const [teams, setTeams] = useState<Map<string, TeamData>>(new Map());
  const [scores, setScores] = useState<ScoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !currentUser) return;
    setLoading(true);
    let scoresUnsubscribe: Unsubscribe | null = null;

    const fetchInitialDataAndListen = async () => {
      try {
        const eventRef = doc(db, "events", eventId);
        const eventSnap = await getDoc(eventRef);
        if (!eventSnap.exists()) throw new Error("Event not found.");
        setEventData({ id: eventSnap.id, ...eventSnap.data() } as EventData);

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
            setLoading(false);
            setError(null);
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

    return () => {
      if (scoresUnsubscribe) scoresUnsubscribe();
    };
  }, [eventId, currentUser, router]);

  const leaderboardData = useMemo((): LeaderboardEntry[] => {
    const aggregatedScores: { [teamId: string]: LeaderboardEntry } = {};

    teams.forEach((team) => {
      aggregatedScores[team.id] = {
        teamId: team.id,
        teamName: team.name,
        totalPoints: 0,
      };
    });

    scores.forEach((score) => {
      if (aggregatedScores[score.teamId]) {
        aggregatedScores[score.teamId].totalPoints += score.points;
      }
    });

    return Object.values(aggregatedScores).sort(
      (a, b) => b.totalPoints - a.totalPoints
    );
  }, [scores, teams]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-400 to-blue-500 text-white">
        <p className="text-lg font-medium">Loading leaderboard...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-400 to-blue-500 text-white">
      <div className="container mx-auto p-6 max-w-4xl">
        <Link
          href={`/event/${eventId}/manage`}
          className="text-blue-200 hover:underline mb-4 block"
        >
          ← Back to Event Management
        </Link>
        <h1 className="text-3xl font-bold mb-6 text-center">
          Leaderboard: {eventData?.name || "Event"}
        </h1>

        {error && (
          <p className="text-red-500 bg-red-100 p-3 rounded mb-4 text-center">
            {error}
          </p>
        )}

        {leaderboardData.length > 0 ? (
          <div className="overflow-x-auto bg-white rounded-lg shadow-md">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-200 italic text-center">
            No scores submitted yet, or no teams found.
          </p>
        )}
      </div>
    </div>
  );
}
