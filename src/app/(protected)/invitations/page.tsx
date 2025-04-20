// src/app/(protected)/invitations/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/firebase.config";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  runTransaction,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { arrayUnion } from "firebase/firestore";

interface Invite {
  id: string;
  eventId: string;
  eventName?: string; // Now included when creating invite
  recipientEmail: string;
  status: string;
  sentBy: string;
}

export default function InvitationsPage() {
  const { currentUser } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(
    null
  ); // Track which invite is being processed

  const fetchInvites = useCallback(async () => {
    if (!currentUser || !currentUser.email) return;

    setLoading(true);
    setError(null);
    try {
      const invitesCollectionRef = collection(db, "invites");
      const q = query(
        invitesCollectionRef,
        where("recipientEmail", "==", currentUser.email),
        where("status", "==", "pending")
      );

      const querySnapshot = await getDocs(q);
      const fetchedInvites: Invite[] = [];
      querySnapshot.forEach((doc) => {
        fetchedInvites.push({ id: doc.id, ...doc.data() } as Invite);
      });
      setInvites(fetchedInvites);
    } catch (err: any) {
      console.error("Error fetching invitations:", err);
      setError("Failed to load invitations. " + err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]); // Re-run if currentUser changes

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleAccept = async (invite: Invite) => {
    if (!currentUser || !currentUser.uid) return;
    if (currentUser.currentEventId) {
      setError(
        `You are already part of an event. Please leave your current event before joining another.`
      );
      // Optional: Provide a way to leave the current event if desired
      return;
    }

    setProcessingInviteId(invite.id); // Mark this invite as being processed
    setError(null);

    const inviteRef = doc(db, "invites", invite.id);
    const eventRef = doc(db, "events", invite.eventId);
    const userRef = doc(db, "users", currentUser.uid);

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Read the event doc within the transaction (optional but good practice if checking event status/capacity)
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists()) {
          throw new Error(
            "Event associated with this invite no longer exists."
          );
        }
        const eventData = eventSnap.data();
        // Add checks here if needed, e.g., event status check
        // if (eventData.status !== 'inviting') {
        //     throw new Error("This event is no longer accepting participants.");
        // }

        // 2. Update Invite status
        transaction.update(inviteRef, { status: "accepted" });

        // 3. Update Event: Add user to participants and draft pool
        transaction.update(eventRef, {
          participantIds: arrayUnion(currentUser.uid),
          availableForDraftIds: arrayUnion(currentUser.uid),
        });

        // 4. Update User's profile
        transaction.update(userRef, {
          currentEventId: invite.eventId,
          teamId: null, // Reset teamId when joining a new event
        });
      });

      console.log(`Invite ${invite.id} accepted successfully.`);
      // Update UI: Remove accepted invite from the list
      setInvites((prevInvites) =>
        prevInvites.filter((i) => i.id !== invite.id)
      );
    } catch (err: any) {
      console.error("Error accepting invite:", err);
      setError(`Failed to accept invite: ${err.message}. Please try again.`);
    } finally {
      setProcessingInviteId(null); // Finished processing
    }
  };

  const handleDecline = async (inviteId: string) => {
    setProcessingInviteId(inviteId); // Mark this invite as being processed
    setError(null);

    const inviteRef = doc(db, "invites", inviteId);
    try {
      await updateDoc(inviteRef, {
        status: "declined",
      });
      console.log(`Invite ${inviteId} declined successfully.`);
      // Update UI: Remove declined invite
      setInvites((prevInvites) => prevInvites.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      console.error("Error declining invite:", err);
      setError(`Failed to decline invite: ${err.message}. Please try again.`);
    } finally {
      setProcessingInviteId(null); // Finished processing
    }
  };

  // --- Render Logic ---
  if (loading)
    return <div className="container mx-auto p-4">Loading invitations...</div>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Your Event Invitations</h1>

      {error && (
        <p className="text-red-500 bg-red-100 p-3 rounded mb-4">{error}</p>
      )}

      {invites.length === 0 && !loading && (
        <p className="text-gray-600">You have no pending invitations.</p>
      )}

      {invites.length > 0 && (
        <ul className="space-y-4">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="p-4 bg-white rounded shadow-md border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center"
            >
              <div>
                <p className="text-lg font-semibold">
                  {invite.eventName || `Invite to Event ID: ${invite.eventId}`}
                </p>
                {/* <p className="text-sm text-gray-500">Event ID: {invite.eventId}</p> */}
              </div>
              <div className="flex space-x-3 mt-3 sm:mt-0">
                <button
                  onClick={() => handleAccept(invite)}
                  disabled={
                    processingInviteId === invite.id ||
                    !!currentUser?.currentEventId
                  } // Disable if processing this or user already in event
                  className={`px-4 py-1 rounded text-white font-semibold text-sm ${
                    processingInviteId === invite.id ||
                    !!currentUser?.currentEventId
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-500 hover:bg-green-600"
                  }`}
                >
                  {processingInviteId === invite.id
                    ? "Processing..."
                    : "Accept"}
                </button>
                <button
                  onClick={() => handleDecline(invite.id)}
                  disabled={processingInviteId === invite.id} // Disable if processing this invite
                  className={`px-4 py-1 rounded text-white font-semibold text-sm ${
                    processingInviteId === invite.id
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600"
                  }`}
                >
                  {processingInviteId === invite.id
                    ? "Processing..."
                    : "Decline"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
