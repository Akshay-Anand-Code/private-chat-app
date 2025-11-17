"use client";

import React, { useState, useEffect } from 'react';
import { MessageCircle, Users, LogOut, Plus, Send, Copy, Check, Mail } from 'lucide-react'; // Added Mail icon
// IMPORT FIRESTORE/RTDB HELPERS
import { auth, db } from '../lib/firebase'; 
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  // Added reload to force update of user.emailVerified status in client
  reload,
} from 'firebase/auth';

// NEW: Realtime Database Imports
import { 
    getDatabase, 
    ref, 
    set, 
    push, 
    onValue, 
    off, 
    serverTimestamp
} from 'firebase/database';

// Initialize RTDB instance
const rtdb = getDatabase(auth.app);

 function AnonymousGroupChat() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });

  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Helper to check verification status based on the live auth user object
  const checkVerification = () => {
    const user = auth.currentUser;
    if (user && !user.emailVerified) {
      alert("Action blocked: Please verify your email address first. Check your inbox for the link.");
      return false;
    }
    return true;
  };

  // -------------------------
  // AUTHENTICATION
  // -------------------------
  const handleAuth = async (e) => {
    e.preventDefault();

    if (authMode === 'signup' && !authForm.name) {
      alert('Name is required for signup');
      return;
    }
    if (!authForm.email || !authForm.password) {
      alert('Email and password are required');
      return;
    }

    try {
      let userCredential;

      if (authMode === 'signup') {
        userCredential = await createUserWithEmailAndPassword(
          auth,
          authForm.email,
          authForm.password
        );

        // Security: Send verification email immediately after signup
        await sendEmailVerification(userCredential.user);
        alert('Sign up successful! Please check your email to verify your account before logging in.');
        await signOut(auth); // Force sign out to require login + verification check
        setAuthMode('login'); 
        return; 
      } else {
        userCredential = await signInWithEmailAndPassword(
          auth,
          authForm.email,
          authForm.password
        );
        
        // Security: Check if the email is verified on login
        if (!userCredential.user.emailVerified) {
            // Optional: Resend verification email on failed login
            await sendEmailVerification(userCredential.user);
            await signOut(auth); 
            alert('Verification Required: Please verify your email address to continue. Check your inbox for the link.');
            return;
        }
      }

      // Populate current user object
      const user = {
        id: userCredential.user.uid,
        email: userCredential.user.email,
        name: authForm.name || userCredential.user.email.split('@')[0],
        isAdmin: userCredential.user.email.includes('admin'),
      };

      setCurrentUser(user);
      localStorage.setItem('currentUser', JSON.stringify(user));
      setAuthForm({ name: '', email: '', password: '' });

    } catch (error) {
      alert(error.message);
    }
  };

  // -------------------------
  // RESEND VERIFICATION EMAIL
  // -------------------------
  const handleResendVerification = async () => {
    const user = auth.currentUser;

    if (user && !user.emailVerified) {
        try {
            await sendEmailVerification(user);
            alert('Verification email sent! Check your inbox (and spam folder) for the link.');
        } catch (error) {
            alert('Failed to send verification email: ' + error.message);
        }
    } else {
        alert('You are already verified or not logged in.');
    }
  };

  // -------------------------
  // LOGOUT
  // -------------------------
  const handleLogout = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setSelectedGroup(null);
    setGroups([]);
    setMessages([]);
    localStorage.removeItem('currentUser');
  };

  // -------------------------
  // GROUP CREATION (Uses RTDB)
  // -------------------------
  const handleCreateGroup = async () => {
    if (!checkVerification()) return; // Security Check

    if (!newGroupName.trim()) return;
    if (!currentUser?.isAdmin) {
      alert('Only admins can create groups');
      return;
    }

    const groupRef = push(ref(rtdb, 'groups'));
    const groupId = groupRef.key;

    const newGroup = {
      id: groupId,
      name: newGroupName,
      adminId: currentUser.id,
      code: Math.random().toString(36).substring(2, 10).toUpperCase(),
      sharedLink: `GROUP-${Date.now().toString().slice(-6)}`,
      members: {
        [currentUser.id]: { userId: currentUser.id, alias: `${currentUser.name} (Admin)` }
      },
      createdAt: serverTimestamp() // Use Firebase server timestamp
    };
    
    try {
      await set(groupRef, newGroup);
      setNewGroupName('');
      setShowCreateGroup(false);
      setSelectedGroup(newGroup); // Select the new group automatically
    } catch (error) {
      alert("Failed to create group: " + error.message);
    }
  };

  // -------------------------
  // JOIN GROUP WITH CODE (Uses RTDB)
  // -------------------------
  const handleJoinGroup = async () => {
    if (!checkVerification()) return; // Security Check

    if (!joinCode.trim()) return;

    const groupToJoin = groups.find(
      (g) => g.code === joinCode.toUpperCase() || g.sharedLink === joinCode
    );

    if (!groupToJoin) {
      alert('Invalid group code or link');
      return;
    }

    // Check if member already exists (RTDB stores members as an object map)
    const memberExists = Object.keys(groupToJoin.members || {}).includes(currentUser.id);
    if (memberExists) {
      alert('You are already a member of this group');
      setJoinCode('');
      setShowJoinModal(false);
      return;
    }

    try {
      const memberAlias = `User ${Math.floor(Math.random() * 1000)}`;
      const memberData = {
        userId: currentUser.id,
        alias: memberAlias
      };

      // Path to update: groups/{groupId}/members/{userId}
      await set(ref(rtdb, `groups/${groupToJoin.id}/members/${currentUser.id}`), memberData);

      setJoinCode('');
      setShowJoinModal(false);
      alert(`Successfully joined the group! Your anonymous alias is ${memberAlias}`);
      setSelectedGroup(groupToJoin);

    } catch (error) {
      alert("Failed to join group: " + error.message);
    }
  };

  // -------------------------
  // SEND MESSAGE (Uses RTDB)
  // -------------------------
  const handleSendMessage = async () => {
    if (!checkVerification()) return; // Security Check
    
    if (!newMessage.trim() || !selectedGroup) return;

    // Find the member's alias from the local selectedGroup state
    const member = selectedGroup.members[currentUser.id]; 

    const message = {
      groupId: selectedGroup.id,
      alias: member?.alias || 'Anonymous',
      content: newMessage,
      timestamp: serverTimestamp() // Use Firebase server timestamp
    };

    try {
      // Push message to messages/{groupId}
      await push(ref(rtdb, `messages/${selectedGroup.id}`), message);
      setNewMessage('');
    } catch (error) {
      alert("Failed to send message: " + error.message);
    }
  };

  // -------------------------
  // RTDB LISTENERS (useEffect)
  // -------------------------

  // 1. Group Listener
  useEffect(() => {
    if (!currentUser) {
      setGroups([]);
      return;
    }

    const groupsRef = ref(rtdb, 'groups');
    
    // Listen for changes to all groups
    const unsubscribe = onValue(groupsRef, (snapshot) => {
      const groupsData = snapshot.val();
      const loadedGroups = [];
      if (groupsData) {
        Object.keys(groupsData).forEach(key => {
          loadedGroups.push({
            ...groupsData[key],
            id: key,
            // Convert members object back to an array for easy filtering later, 
            // though keeping it as an object map is often easier for RTDB rules/updates
            members: groupsData[key].members || {} 
          });
        });
      }
      setGroups(loadedGroups);
    });

    // Cleanup function
    return () => off(groupsRef, 'value', unsubscribe);
  }, [currentUser]);


  // 2. Messages Listener
  useEffect(() => {
    if (!selectedGroup) {
      setMessages([]);
      return;
    }

    const messagesRef = ref(rtdb, `messages/${selectedGroup.id}`);

    // Listen for changes to the selected group's messages
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const messagesData = snapshot.val();
      const loadedMessages = [];
      if (messagesData) {
        Object.keys(messagesData).forEach(key => {
          loadedMessages.push({
            ...messagesData[key],
            id: key,
            // Convert Firebase timestamp to readable JS Date for display
            timestamp: messagesData[key].timestamp || Date.now()
          });
        });
      }
      // Sort messages by timestamp
      loadedMessages.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(loadedMessages);
    });

    // Cleanup function
    return () => off(messagesRef, 'value', unsubscribe);
  }, [selectedGroup]);


  // -------------------------
  // COPY CODE
  // -------------------------
  const handleCopyCode = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // -------------------------
  // FILTERS
  // -------------------------
  // Messages are already filtered and loaded by the useEffect hook
  // Filter groups that the current user is a member of
  const userGroups = groups.filter((g) => {
    // Check if the current user ID is a key in the members object
    return g.members && Object.keys(g.members).includes(currentUser?.id);
  });

  // -------------------------
  // LOAD USER FROM LOCALSTORAGE / Firebase Auth State Listener
  // -------------------------
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async user => {
      if (user) {
        // If the user is logged in, but unverified, force a reload to get fresh status
        // and ensure the check on `isVerified` below is accurate.
        if (!user.emailVerified) {
            await reload(user);
        }
        
        const localUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
        
        setCurrentUser({
          id: user.uid,
          email: user.email,
          name: localUser.name || user.email.split('@')[0],
          isAdmin: user.email.includes('admin'),
        });
      } else {
        setCurrentUser(null);
        setSelectedGroup(null);
        setGroups([]);
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // -------------------------
  // UI — AUTH SCREEN
  // -------------------------
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <MessageCircle className="w-16 h-16 mx-auto text-indigo-600 mb-4" />
            <h1 className="text-3xl font-bold text-gray-800">Anonymous Chat</h1>
            <p className="text-gray-600 mt-2">Connect anonymously, chat securely</p>
          </div>

          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                authMode === 'login'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode('signup')}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                authMode === 'signup'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'signup' && (
              <input
                type="text"
                placeholder="Name"
                value={authForm.name}
                onChange={(e) =>
                  setAuthForm({ ...authForm, name: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            )}

            <input
              type="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(e) =>
                setAuthForm({ ...authForm, email: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(e) =>
                setAuthForm({ ...authForm, password: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
            >
              {authMode === 'login' ? 'Login' : 'Sign Up'}
            </button>
          </form>

          <p className="text-sm text-gray-500 mt-6 text-center">
            Use email containing "admin" to access admin features
          </p>
        </div>
      </div>
    );
  }

  // -------------------------
  // UI — MAIN APP
  // -------------------------
  // Read the live verification status from the Firebase user object
  const isVerified = auth.currentUser?.emailVerified;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* SIDEBAR */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">{currentUser.name}</h2>
              <p className="text-sm text-gray-500">
                {currentUser.isAdmin ? 'Admin' : 'User'}
                {!isVerified && (
                    <span className="text-red-500 ml-2 font-bold"> (Unverified)</span>
                )}
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          
          {/* NEW: Resend Verification Button */}
          {!isVerified && (
            <div className="mb-4">
                <button
                    onClick={handleResendVerification}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition-colors text-sm font-medium"
                >
                    <Mail className="w-4 h-4" />
                    Resend Verification Link
                </button>
            </div>
          )}


          <div className="flex gap-2">
            {currentUser.isAdmin && (
              <button
                onClick={() => isVerified && setShowCreateGroup(true)}
                disabled={!isVerified}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition-colors ${
                    isVerified ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Plus className="w-4 h-4" />
                Create
              </button>
            )}

            <button
              onClick={() => isVerified && setShowJoinModal(true)}
              disabled={!isVerified}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition-colors ${
                isVerified ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Users className="w-4 h-4" />
              Join
            </button>
          </div>
        </div>

        {/* GROUP LIST */}
        <div className="flex-1 overflow-y-auto p-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
            Your Groups
          </h3>

          {userGroups.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No groups yet
            </p>
          ) : (
            userGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => setSelectedGroup(group)}
                className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                  selectedGroup?.id === group.id
                    ? 'bg-indigo-50 border border-indigo-200'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-800">{group.name}</span>
                  <span className="text-xs text-gray-500">
                    {Object.keys(group.members || {}).length}
                  </span>
                </div>

                {currentUser.id === group.adminId && (
                  <span className="text-xs text-indigo-600">Admin</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col">
        {selectedGroup ? (
          <>
            {/* HEADER */}
            <div className="bg-white border-b border-gray-200 p-4 flex justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">
                  {selectedGroup.name}
                </h2>
                <p className="text-sm text-gray-500">
                  {Object.keys(selectedGroup.members || {}).length} members
                </p>
              </div>

              <button
                onClick={() => handleCopyCode(selectedGroup.code)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {copiedCode ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span className="text-sm font-mono">{selectedGroup.code}</span>
              </button>
            </div>

            {/* MESSAGES */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 mt-8">
                  <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-white rounded-lg p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-indigo-600">
                        {msg.alias}
                      </span>
                      <span className="text-xs text-gray-500">
                        {/* Ensure timestamp conversion handles serverTimestamp format */}
                        {msg.timestamp?.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString() : new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-gray-800">{msg.content}</p>
                  </div>
                ))
              )}
            </div>

            {/* INPUT */}
            <div className="bg-white border-t border-gray-200 p-4 flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && isVerified && handleSendMessage()}
                placeholder={isVerified ? "Type your message..." : "Verify email to chat"}
                disabled={!isVerified}
                className={`flex-1 px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${!isVerified ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-300'}`}
              />

              <button
                onClick={handleSendMessage}
                disabled={!isVerified || !newMessage.trim()}
                className={`px-6 py-3 rounded-lg transition-colors ${
                    isVerified && newMessage.trim() 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Select a group to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* CREATE GROUP MODAL */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-4">Create New Group</h3>

            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreateGroup(false);
                  setNewGroupName('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>

              <button
                onClick={handleCreateGroup}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN GROUP MODAL */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-4">Join Group</h3>

            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter group code or link"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setJoinCode('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>

              <button
                onClick={handleJoinGroup}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default AnonymousGroupChat;