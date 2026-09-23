import admin from "firebase-admin";
import fs from "node:fs";
import { config } from "../config.js";

let app: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (app) return app;
  if (admin.apps.length) {
    app = admin.apps[0]!;
    return app;
  }
  let credential: admin.credential.Credential | undefined;
  if (config.firebaseServiceAccountJson) {
    credential = admin.credential.cert(JSON.parse(config.firebaseServiceAccountJson));
  } else if (config.googleCredentialsPath && fs.existsSync(config.googleCredentialsPath)) {
    credential = admin.credential.cert(JSON.parse(fs.readFileSync(config.googleCredentialsPath, "utf8")));
  }
  // Without credentials the app can still verify ID tokens (public certs + project id).
  app = admin.initializeApp({ projectId: config.firebaseProjectId, ...(credential ? { credential } : {}) });
  return app;
}

export function getFirestoreDb() {
  return getAdminApp().firestore();
}

export async function verifyIdToken(token: string): Promise<{ uid: string; email?: string; name?: string }> {
  const decoded = await getAdminApp().auth().verifyIdToken(token);
  return { uid: decoded.uid, email: decoded.email, name: decoded.name as string | undefined };
}
