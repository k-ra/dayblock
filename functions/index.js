/* Quick-note sorting: a personal key stays in Firestore and is read only here.
   Without one, Dayblock's Firebase secret pays for the free allowance. */
'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');
const Q = require('./shared-quick-notes.js');   // copied from the site at deploy
const { createSortNote, createPersonalSort, SortError } = require('./sort.js');

initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const cors = [/^https:\/\/k-ra\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const signedInPerson = request => request.auth?.uid && request.auth.token?.firebase?.sign_in_provider !== 'anonymous';

exports.aiKeyStatus = onCall({ region: 'us-central1', cors, maxInstances: 3 }, async request => {
  if (!signedInPerson(request)) throw new HttpsError('unauthenticated', 'Sign in to see your AI connection.');
  const snapshot = await getFirestore().doc(`users/${request.auth.uid}/secrets/ai`).get();
  const secret = snapshot.exists ? snapshot.data() : null;
  return { provider: secret?.key && ['anthropic', 'openai'].includes(secret.provider) ? secret.provider : null };
});

exports.sortNote = onCall({
  region: 'us-central1',
  secrets: [ANTHROPIC_API_KEY],
  cors,
  maxInstances: 3,
  timeoutSeconds: 30,
  memory: '256MiB',
}, async request => {
  if (!signedInPerson(request)) throw new HttpsError('unauthenticated', 'Sign in to sort notes.');
  const db = getFirestore();
  const classify = (text, now, provider, apiKey) => Q.classify(text, {
    provider, apiKey, now, load: async () => ({ default: Anthropic }),
  });
  const sort = createSortNote({
    db,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    classify: (text, now) => classify(text, now, 'anthropic', ANTHROPIC_API_KEY.value()),
  });
  const personal = createPersonalSort({ db, classify });
  try {
    const args = { uid: request.auth?.uid, text: request.data?.text, today: request.data?.today };
    const personalResult = await personal(args);
    if (personalResult) return personalResult;
    return { ...(await sort(args)), personal: false, provider: 'anthropic' };
  } catch (error) {
    if (error instanceof SortError) throw new HttpsError(error.code, error.message);
    throw new HttpsError('internal', 'Sorting failed.');
  }
});
