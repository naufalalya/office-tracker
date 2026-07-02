# Office Tracker

Aplikasi Next.js + Firebase untuk mencatat project kantor, deadline, status, prioritas, dan note progress.

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Isi `.env.local` dari Firebase project kamu.

## Firebase Auth

Buat user Email/Password:

- alya-kerja@office.local

Username di app: `alya-kerja`.

## Firestore Collections

- workProjects
- workProjectNotes

## Firestore Rules awal

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
