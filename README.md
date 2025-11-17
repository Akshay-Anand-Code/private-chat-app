This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

# Real-Time Private Chat Application

A simple real-time chat application built with Next.js, Firebase Authentication, and Firebase Realtime Database.

## Features

- User authentication (Email/Password)
- Real-time messaging
- User list with online/offline status
- One-on-one chat functionality

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
4. Enable Email/Password authentication in Firebase Authentication
5. Create a Realtime Database and deploy the security rules
6. Add your Firebase configuration to `lib/firebase.js`

## Firebase Configuration

Update the Firebase config in `lib/firebase.js`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

## Running the Project

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Important Notes

⚠️ **Verification emails may go to your spam folder**. Please check spam if you don't receive the verification email immediately.

## Usage

1. Register with your email and password
2. Verify your email (check spam folder)
3. Log in to access the chat
4. Select a user from the list to start chatting

