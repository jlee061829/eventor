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
} from "firebase/firestore";
import { arrayUnion } from "firebase/firestore";

interface Invite {
  id: string;
  eventId: string;
  eventName?: string;
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
  );

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
  }, [currentUser]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleAccept = async (invite: Invite) => {
    if (!currentUser || !currentUser.uid) return;
    if (currentUser.currentEventId) {
      setError(`You are already part of an event.`);
      return;
    }
    setProcessingInviteId(invite.id);
    setError(null);

    const inviteRef = doc(db, "invites", invite.id);
    const eventRef = doc(db, "events", invite.eventId);
    const userRef = doc(db, "users", currentUser.uid);

    try {
      await runTransaction(db, async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists()) {
          throw new Error(
            "Event associated with this invite no longer exists."
          );
        }

        transaction.update(inviteRef, { status: "accepted" });
        transaction.update(eventRef, {
          participantIds: arrayUnion(currentUser.uid),
          availableForDraftIds: arrayUnion(currentUser.uid),
        });
        transaction.update(userRef, {
          currentEventId: invite.eventId,
          teamId: null,
        });
      });

      console.log(`Invite ${invite.id} accepted successfully.`);
      setInvites((prevInvites) =>
        prevInvites.filter((i) => i.id !== invite.id)
      );
    } catch (err: any) {
      console.error("Error accepting invite:", err);
      setError(`Failed to accept invite: ${err.message}. Please try again.`);
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleDecline = async (inviteId: string) => {
    setProcessingInviteId(inviteId);
    setError(null);

    const inviteRef = doc(db, "invites", inviteId);
    try {
      await updateDoc(inviteRef, {
        status: "declined",
      });
      console.log(`Invite ${inviteId} declined successfully.`);
      setInvites((prevInvites) => prevInvites.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      console.error("Error declining invite:", err);
      setError(`Failed to decline invite: ${err.message}. Please try again.`);
    } finally {
      setProcessingInviteId(null);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-400 to-blue-500 text-white">
        <p className="text-lg font-medium">Loading invitations...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-400 to-blue-500 text-white">
      <div className="container mx-auto p-6 max-w-4xl">
        <h1 className="text-3xl font-bold mb-6 text-center">
          Your Event Invitations
        </h1>

        {error && (
          <p className="text-red-500 bg-red-100 p-3 rounded mb-4 text-center">
            {error}
          </p>
        )}

        {invites.length === 0 && !loading && (
          <p className="text-center text-lg text-gray-200">
            You have no pending invitations.
          </p>
        )}

        {invites.length > 0 && (
          <ul className="space-y-4">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="p-6 bg-white rounded-lg shadow-md border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center"
              >
                <div>
                  <p className="text-lg font-semibold text-gray-800">
                    {invite.eventName || `Invite to Event ID: ${invite.eventId}`}
                  </p>
                  <p className="text-sm text-gray-500">
                    Sent by: {invite.sentBy}
                  </p>
                </div>
                <div className="flex space-x-3 mt-3 sm:mt-0">
                  <button
                    onClick={() => handleAccept(invite)}
                    disabled={
                      processingInviteId === invite.id ||
                      !!currentUser?.currentEventId
                    }
                    className={`px-4 py-2 rounded text-white font-semibold text-sm ${
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
                    disabled={processingInviteId === invite.id}
                    className={`px-4 py-2 rounded text-white font-semibold text-sm ${
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
    </div>
  );
}
