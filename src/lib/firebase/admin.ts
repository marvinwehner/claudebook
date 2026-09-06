import "server-only";

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Admin SDK, initialised from Application Default Credentials.
 *
 * On App Hosting the Cloud Run service account supplies ADC and
 * GOOGLE_CLOUD_PROJECT automatically. Locally, `gcloud auth
 * application-default login` does the same. There is no service-account JSON
 * anywhere in this repo, on purpose.
 *
 * Initialisation is deferred to first use so `next build` never needs
 * credentials.
 */
function adminApp(): App {
  return getApps()[0] ?? initializeApp();
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
