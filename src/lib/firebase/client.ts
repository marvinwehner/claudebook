"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

import { publicEnv } from "@/lib/config/env";

/**
 * Browser-side Firebase — **auth only**.
 *
 * `firebase/firestore` is deliberately never imported here. The browser holds a
 * session cookie and talks to our route handlers; Firestore is server-side, and
 * firestore.rules is a flat default-deny to keep it that way.
 */
function clientApp(): FirebaseApp {
  const env = publicEnv();
  return (
    getApps()[0] ??
    initializeApp({
      apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
    })
  );
}

export function clientAuth(): Auth {
  return getAuth(clientApp());
}

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always show the chooser: this is an invite-only app and the first account
  // Chrome offers is usually the wrong one.
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}
