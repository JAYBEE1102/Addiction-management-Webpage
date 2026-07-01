// =========================================================
// FIREBASE CONFIGURATION & INITIALIZATION
// =========================================================
const firebaseConfig = window.FIREBASE_CONFIG || {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
    if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
    } else {
        console.warn("JAYFOUND: Replace the Firebase placeholder configuration block at the top of app.js with your project settings.");
    }
} else {
    console.error("Firebase SDK script library missing from page context.");
}

// Global Application State Variables
let currentAuthUser = null;
let currentProfileData = null;
let isSignUpMode = true;
let selectedEmotionTag = '🌿 Grateful';
let phoneConfirmationResult = null;
let phoneResendCountdown = 60;
let phoneResendInterval = null;

// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const formTitle = document.getElementById('form-title');
const formSubtitle = document.getElementById('form-subtitle');
const submitBtn = document.getElementById('submit-btn');
const toggleText = document.getElementById('toggle-text');
const toggleBtn = document.getElementById('toggle-btn');
const passwordInput = document.getElementById('password');
const eyeBtn = document.getElementById('eye-btn');
const eyeSvg = document.getElementById('eye-svg');
const toast = document.getElementById('toast');
const authErrorBox = document.getElementById('auth-error-box');

// Dashboard Header / Profile Display
const userDisplayEmail = document.getElementById('user-display-email');
const userDisplayRole = document.getElementById('user-display-role');
const sidebarAvatar = document.getElementById('sidebar-avatar');
const pageGreeting = document.getElementById('page-greeting');

// Modals
const phoneAuthModal = document.getElementById('phone-auth-modal');
const reportUserModal = document.getElementById('report-user-modal');

// =========================================================
// REAL-TIME AUTHENTICATION STATE WATCHER
// =========================================================
if (typeof firebase !== 'undefined') {
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            currentAuthUser = user;
            try {
                // Check if user document exists in Firestore, if not create it
                const userRef = firebase.firestore().collection('users').doc(user.uid);
                const doc = await userRef.get();
                
                if (!doc.exists) {
                    // Create default wellness profile document in cloud storage
                    let defaultName = user.displayName || user.email ? user.email.split('@')[0] : "Peer Friend";
                    if (user.phoneNumber) defaultName = `User ${user.phoneNumber.slice(-4)}`;
                    
                    const defaultProfile = {
                        uid: user.uid,
                        name: defaultName,
                        email: user.email || "",
                        phone: user.phoneNumber || "",
                        photoURL: user.photoURL || "",
                        streak: 30,
                        streakTarget: 60,
                        notifs: true,
                        isAdmin: false,
                        suspended: false,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    await userRef.set(defaultProfile);
                    currentProfileData = defaultProfile;
                } else {
                    currentProfileData = doc.data();
                }

                // Check suspension status (Strict enforcement)
                if (currentProfileData.suspended === true) {
                    showToast("Access Blocked: This account has been suspended for terms violations.");
                    firebase.auth().signOut();
                    return;
                }

                // Initialize recaptcha solver on successful authentication transition
                loginUserSession(currentProfileData);
                
            } catch (error) {
                console.error("Error reading/writing user profile database document:", error);
                showAuthError("Database synchronization failed: " + error.message);
                firebase.auth().signOut();
            }
        } else {
            currentAuthUser = null;
            currentProfileData = null;
            dashboardSection.classList.add('hidden');
            authSection.classList.remove('hidden');
            
            // Clean up admin controls or references
            document.querySelectorAll('.admin-nav-btn').forEach(el => el.classList.add('hidden'));
        }
    });
}

// Password toggle eye button listener
eyeBtn.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
    if (isPassword) {
        eyeSvg.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
    } else {
        eyeSvg.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
    }
});

// Toggle mode triggers
function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    hideAuthError();
    clearAllValidationMessages();
    if (isSignUpMode) {
        formTitle.textContent = 'Create an account';
        formSubtitle.textContent = 'Join JAYFOUND to access your daily wellness workspace.';
        submitBtn.textContent = 'Get Started';
        toggleText.textContent = "Already have an account?";
        toggleBtn.textContent = 'Log in';
    } else {
        formTitle.textContent = 'Welcome back';
        formSubtitle.textContent = 'Sign in to JAYFOUND using your credentials.';
        submitBtn.textContent = 'Sign In';
        toggleText.textContent = "Don't have an account?";
        toggleBtn.textContent = 'Sign up';
    }
}

// =========================================================
// STRICT FORM VALIDATIONS (Client-Side Constraints)
// =========================================================
function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

function validatePassword(password) {
    // Min 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    return regex.test(password);
}

function validatePhoneNumber(phone) {
    // Require leading +, country code, and at least 7 digits (max 15 as per E.164)
    const regex = /^\+[1-9]\d{6,14}$/;
    return regex.test(phone);
}

function clearAllValidationMessages() {
    document.querySelectorAll('.validation-error').forEach(el => el.textContent = "");
}

// =========================================================
// SECURE USER AUTHENTICATION HANDLERS
// =========================================================

// Email/Password Submit handler
function handleFormSubmit(event) {
    event.preventDefault();
    hideAuthError();
    clearAllValidationMessages();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    let hasErrors = false;

    if (!validateEmail(email)) {
        document.getElementById('val-err-email').textContent = "Please enter a valid email address (e.g. name@example.com).";
        hasErrors = true;
    }

    // Passwords must be validated on login and registration, enforcing safety rule
    if (isSignUpMode && !validatePassword(password)) {
        document.getElementById('val-err-password').textContent = "Password must be at least 8 characters and include at least one uppercase letter, one lowercase letter, one number, and one special character.";
        hasErrors = true;
    } else if (password.length === 0) {
        document.getElementById('val-err-password').textContent = "Password cannot be empty.";
        hasErrors = true;
    }

    if (hasErrors) return;

    if (isSignUpMode) {
        // Firebase Auth registration
        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then((result) => {
                showToast("Account created successfully!");
            })
            .catch((error) => {
                showAuthError("Registration failed: " + error.message);
            });
    } else {
        // Firebase Auth sign in
        firebase.auth().signInWithEmailAndPassword(email, password)
            .catch((error) => {
                showAuthError("Invalid credentials: " + error.message);
            });
    }
}

// Real Google Sign-In with conflict resolution
function handleGoogleSignIn() {
    hideAuthError();
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .catch((error) => {
            console.error("Google Auth error caught:", error);
            if (error.code === 'auth/account-exists-with-different-credential') {
                showAuthError("An account already exists with this email address. Please sign in using your original method (Email & Password).");
            } else {
                showAuthError("Google Sign-In failed: " + error.message);
            }
        });
}

// Real Facebook Sign-In with conflict resolution
function handleFacebookSignIn() {
    hideAuthError();
    const provider = new firebase.auth.FacebookAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .catch((error) => {
            console.error("Facebook Auth error caught:", error);
            if (error.code === 'auth/account-exists-with-different-credential') {
                showAuthError("An account already exists with this email address. Please sign in using your original method (Email & Password).");
            } else {
                showAuthError("Facebook Sign-In failed: " + error.message);
            }
        });
}

// =========================================================
// REAL FIREBASE PHONE AUTHENTICATION (Invisible reCAPTCHA)
// =========================================================
function openPhoneAuthModal() {
    phoneAuthModal.classList.remove('hidden');
    document.getElementById('phone-step-1-form').classList.remove('hidden');
    document.getElementById('phone-step-2-form').classList.add('hidden');
    clearAllValidationMessages();

    // Initialize recaptcha container context
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {
                // Invisible recaptcha solved
            }
        });
    }
}

function closePhoneAuthModal() {
    phoneAuthModal.classList.add('hidden');
    if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
    }
}

function handlePhoneVerifySubmit(event) {
    event.preventDefault();
    clearAllValidationMessages();

    const phone = document.getElementById('auth-phone-num').value.trim();
    if (!validatePhoneNumber(phone)) {
        document.getElementById('val-err-phone').textContent = "Enter a valid E.164 international phone number starting with + (e.g., +15551234567).";
        return;
    }

    const submitBtn = document.getElementById('phone-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending Verification...";

    firebase.auth().signInWithPhoneNumber(phone, window.recaptchaVerifier)
        .then((confirmationResult) => {
            phoneConfirmationResult = confirmationResult;
            document.getElementById('phone-step-1-form').classList.add('hidden');
            document.getElementById('phone-step-2-form').classList.remove('hidden');
            showToast("SMS OTP verification code sent.");
            startPhoneResendTimer();
        })
        .catch((error) => {
            submitBtn.disabled = false;
            submitBtn.textContent = "Send SMS OTP";
            document.getElementById('val-err-phone').textContent = "Phone verification failed: " + error.message;
        });
}

function handleCodeConfirmSubmit(event) {
    event.preventDefault();
    clearAllValidationMessages();

    const otp = document.getElementById('auth-phone-otp').value.trim();
    if (otp.length !== 6 || isNaN(otp)) {
        document.getElementById('val-err-otp').textContent = "OTP code must be a 6-digit number.";
        return;
    }

    phoneConfirmationResult.confirm(otp)
        .then((result) => {
            closePhoneAuthModal();
        })
        .catch((error) => {
            if (error.code === 'auth/invalid-verification-code') {
                document.getElementById('val-err-otp').textContent = "Invalid verification code. Please check your text messages.";
            } else if (error.code === 'auth/code-expired-or-session-invalid' || error.code === 'auth/code-expired') {
                document.getElementById('val-err-otp').textContent = "The OTP code session has expired. Please click 'Resend' to generate a new session.";
            } else {
                document.getElementById('val-err-otp').textContent = "Verification failed: " + error.message;
            }
        });
}

function startPhoneResendTimer() {
    const resendBtn = document.getElementById('phone-resend-btn');
    resendBtn.disabled = true;
    phoneResendCountdown = 60;
    resendBtn.textContent = `Resend (${phoneResendCountdown}s)`;

    clearInterval(phoneResendInterval);
    phoneResendInterval = setInterval(() => {
        phoneResendCountdown--;
        if (phoneResendCountdown <= 0) {
            clearInterval(phoneResendInterval);
            resendBtn.disabled = false;
            resendBtn.textContent = "Resend";
        } else {
            resendBtn.textContent = `Resend (${phoneResendCountdown}s)`;
        }
    }, 1000);
}

function handlePhoneResend() {
    clearAllValidationMessages();
    const phone = document.getElementById('auth-phone-num').value.trim();
    if (!validatePhoneNumber(phone)) return;

    firebase.auth().signInWithPhoneNumber(phone, window.recaptchaVerifier)
        .then((confirmationResult) => {
            phoneConfirmationResult = confirmationResult;
            showToast("SMS OTP resent.");
            startPhoneResendTimer();
        })
        .catch((error) => {
            document.getElementById('val-err-otp').textContent = "Failed to resend SMS code: " + error.message;
        });
}

// =========================================================
// PROFILE PICTURE UPLOADS TO CLOUD STORAGE
// =========================================================
function handleProfilePictureUpload(input) {
    const file = input.files[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
        showToast('Please select a valid image file.');
        return;
    }

    const statusEl = document.getElementById('prof-upload-status');
    statusEl.textContent = 'Uploading...';

    const storageRef = firebase.storage().ref().child(`users/${currentAuthUser.uid}/profile.jpg`);
    const uploadTask = storageRef.put(file);

    uploadTask.on('state_changed',
        null,
        (error) => {
            console.error(error);
            statusEl.textContent = 'Upload failed';
            showToast('Failed to upload image: ' + error.message);
        },
        () => {
            uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
                // Update Firestore user document
                firebase.firestore().collection('users').doc(currentAuthUser.uid).update({
                    photoURL: downloadURL
                }).then(() => {
                    statusEl.textContent = 'Upload complete';
                    showToast('Profile image updated successfully.');
                    
                    // Live update current view state
                    currentProfileData.photoURL = downloadURL;
                    renderProfileAvatars(downloadURL);
                });
            });
        }
    );
}

function renderProfileAvatars(photoURL) {
    if (photoURL) {
        sidebarAvatar.style.backgroundImage = `url('${photoURL}')`;
        sidebarAvatar.style.backgroundSize = 'cover';
        sidebarAvatar.style.backgroundPosition = 'center';
        sidebarAvatar.textContent = '';

        const profileAvatarDisplay = document.getElementById('profile-avatar-display');
        profileAvatarDisplay.style.backgroundImage = `url('${photoURL}')`;
        profileAvatarDisplay.style.backgroundSize = 'cover';
        profileAvatarDisplay.style.backgroundPosition = 'center';
        profileAvatarDisplay.textContent = '';
    }
}

// =========================================================
// REAL-TIME FIRESTORE DATA STREAM INTEGRATIONS
// =========================================================
let journalUnsubscribe = null;
let postsUnsubscribe = null;
let ticketsUnsubscribe = null;

function loginUserSession(userProfile) {
    const nameInitial = userProfile.name.charAt(0).toUpperCase();

    userDisplayEmail.textContent = userProfile.name;
    userDisplayRole.textContent = `Day ${userProfile.streak} Recovery`;
    pageGreeting.textContent = `Welcome back, ${userProfile.name.split(' ')[0]} 👋`;

    // Handle avatar photo display
    if (userProfile.photoURL) {
        renderProfileAvatars(userProfile.photoURL);
    } else {
        sidebarAvatar.style.backgroundImage = 'none';
        sidebarAvatar.textContent = nameInitial;
        const profileAvatarDisplay = document.getElementById('profile-avatar-display');
        profileAvatarDisplay.style.backgroundImage = 'none';
        profileAvatarDisplay.textContent = nameInitial;
    }

    document.getElementById('dash-streak-num').textContent = userProfile.streak;
    document.getElementById('dash-streak-pct').textContent = `${Math.min(100, Math.round((userProfile.streak / userProfile.streakTarget) * 100))}%`;
    document.getElementById('dash-money-saved').textContent = `$${userProfile.streak * 15}`;

    document.getElementById('profile-full-name').textContent = userProfile.name;
    document.getElementById('profile-email-display').textContent = userProfile.email || "No Email Associated";
    document.getElementById('prof-display-name').value = userProfile.name;
    document.getElementById('prof-streak-target').value = userProfile.streakTarget;
    document.getElementById('prof-notif-toggle').checked = userProfile.notifs;

    // Open/Close tabs and sections
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    
    // Check administrative permissions
    if (userProfile.isAdmin === true) {
        document.querySelectorAll('.admin-nav-btn').forEach(el => el.classList.remove('hidden'));
        initAdminViewRealTimeListeners();
    } else {
        document.querySelectorAll('.admin-nav-btn').forEach(el => el.classList.add('hidden'));
    }

    // Subscribe to standard real-time user-specific collections
    initRealTimeListeners();
    renderFaqList();
    renderVideosGrid();
    showToast('Logged into JAYFOUND Recovery Workspace.');
}

function logout() {
    firebase.auth().signOut().then(() => {
        // Cancel all firestore database listeners on logout to free bandwidth
        if (journalUnsubscribe) journalUnsubscribe();
        if (postsUnsubscribe) postsUnsubscribe();
        if (ticketsUnsubscribe) ticketsUnsubscribe();
        if (adminTicketsUnsubscribe) adminTicketsUnsubscribe();
        if (adminUsersUnsubscribe) adminUsersUnsubscribe();
        if (adminReportsUnsubscribe) adminReportsUnsubscribe();
        
        dashboardSection.classList.add('hidden');
        authSection.classList.remove('hidden');
        showToast('Logged out of JAYFOUND.');
    });
}

function initRealTimeListeners() {
    const db = firebase.firestore();

    // 1. Live Journal Reflections Stream
    if (journalUnsubscribe) journalUnsubscribe();
    journalUnsubscribe = db.collection('journal')
        .where('uid', '==', currentAuthUser.uid)
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            const logsList = document.getElementById('journal-logs-list');
            document.getElementById('journal-count-badge').textContent = `${snapshot.size} Entries`;
            logsList.innerHTML = '';

            snapshot.forEach((doc) => {
                const item = doc.data();
                const dateStr = item.createdAt ? new Date(item.createdAt.toDate()).toLocaleString() : "Just now";
                const div = document.createElement('div');
                div.className = 'log-item';
                div.innerHTML = `
                    <div class="log-header">
                        <span class="log-title">${escapeHTML(item.title)}</span>
                        <span class="log-tag">${escapeHTML(item.tag)}</span>
                    </div>
                    <p class="log-text">${escapeHTML(item.text)}</p>
                    <span class="log-date">${escapeHTML(dateStr)}</span>
                    <button class="delete-log-btn" onclick="deleteJournalEntry('${doc.id}')">Delete Reflection</button>
                `;
                logsList.appendChild(div);
            });
        }, (error) => console.error("Journal sub failed:", error));

    // 2. Peer Support Message Board Stream
    if (postsUnsubscribe) postsUnsubscribe();
    postsUnsubscribe = db.collection('posts')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .onSnapshot((snapshot) => {
            const feedList = document.getElementById('feed-list');
            feedList.innerHTML = '';

            snapshot.forEach((doc) => {
                const post = doc.data();
                const formattedTime = post.createdAt ? new Date(post.createdAt.toDate()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now';
                
                // Reaction tracking (using array of UIDs)
                const hasReacted = post.reactions && post.reactions.includes(currentAuthUser.uid);
                const reactionsCount = post.reactions ? post.reactions.length : 0;

                const div = document.createElement('div');
                div.className = 'dash-card feed-card';
                
                // Allow reporting user unless it's yourself
                const isNotSelf = post.uid !== currentAuthUser.uid;
                const reportBtnHtml = isNotSelf ? 
                    `<button class="report-user-btn" style="background:none; border:none; color:#dc2626; font-size:11px; cursor:pointer; margin-left:12px; font-weight:700;" onclick="openReportUserModal('${post.uid}', '${escapeHTML(post.user)}')">⚠️ Report Abuse</button>` : '';

                div.innerHTML = `
                    <div class="feed-header">
                        <div class="feed-avatar" style="background:${post.bg}">${post.avatar}</div>
                        <div>
                            <span class="feed-user">${escapeHTML(post.user)}</span>
                            <span class="feed-time">${formattedTime} • ${post.streak}</span>
                        </div>
                    </div>
                    <p class="feed-text">${escapeHTML(post.text)}</p>
                    <div class="feed-footer" style="display:flex; justify-content:space-between; align-items:center;">
                        <button class="like-btn ${hasReacted ? 'liked' : ''}" onclick="toggleLikePost('${doc.id}')">❤️ <span>${reactionsCount} Support Reactions</span></button>
                        ${reportBtnHtml}
                    </div>
                `;
                feedList.appendChild(div);
            });
        }, (error) => console.error("Posts feed sub failed:", error));

    // 3. User support tickets
    if (ticketsUnsubscribe) ticketsUnsubscribe();
    ticketsUnsubscribe = db.collection('tickets')
        .where('uid', '==', currentAuthUser.uid)
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            renderUserTicketsView(snapshot);
        }, (error) => console.error("User tickets sub failed:", error));
}

// User-Facing Journal Entries CRUD
function saveJournalEntry(event) {
    event.preventDefault();
    const title = document.getElementById('journal-title').value.trim();
    const content = document.getElementById('journal-content').value.trim();

    if (!title || !content) return;

    firebase.firestore().collection('journal').add({
        uid: currentAuthUser.uid,
        title: title,
        tag: selectedEmotionTag,
        text: content,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('journal-title').value = '';
        document.getElementById('journal-content').value = '';
        showToast('Reflection saved to cloud journal 📖');
    }).catch(err => showToast("Failed to save entry: " + err.message));
}

function deleteJournalEntry(id) {
    firebase.firestore().collection('journal').doc(id).delete()
        .then(() => showToast('Reflection deleted.'))
        .catch(err => showToast("Delete failed: " + err.message));
}

function filterJournalEntries() {
    const query = document.getElementById('journal-search-input').value.toLowerCase();
    const items = document.querySelectorAll('#journal-logs-list .log-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? 'block' : 'none';
    });
}

// User-Facing Peer Support actions
function postCommunityMsg(event) {
    event.preventDefault();
    const input = document.getElementById('community-input');
    const text = input.value.trim();
    if (!text) return;

    const initial = currentProfileData.name ? currentProfileData.name.charAt(0).toUpperCase() : "P";
    const bgColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];
    const randomBg = bgColors[Math.floor(Math.random() * bgColors.length)];

    firebase.firestore().collection('posts').add({
        uid: currentAuthUser.uid,
        user: currentProfileData.name || "Anonymous Peer",
        streak: `Day ${currentProfileData.streak || 30}`,
        text: text,
        reactions: [],
        avatar: initial,
        bg: randomBg,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        input.value = '';
        showToast('Shared post with peer support groups.');
    }).catch(err => showToast("Post failed: " + err.message));
}

function toggleLikePost(postId) {
    const db = firebase.firestore();
    const postRef = db.collection('posts').doc(postId);

    db.runTransaction((transaction) => {
        return transaction.get(postRef).then((postDoc) => {
            if (!postDoc.exists) return;
            const data = postDoc.data();
            let reactions = data.reactions || [];

            if (reactions.includes(currentAuthUser.uid)) {
                // Remove like
                reactions = reactions.filter(id => id !== currentAuthUser.uid);
            } else {
                // Add like
                reactions.push(currentAuthUser.uid);
            }
            transaction.update(postRef, { reactions: reactions });
        });
    }).catch(err => console.error("Reaction transaction failed:", err));
}

// User-facing ticket submit
function handleSupportRequestSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('sup-pref-name').value.trim();
    const reason = document.getElementById('sup-reason').value.trim();
    const urgency = document.getElementById('sup-urgency').value;
    const gender = document.getElementById('sup-gender').value;
    const method = document.getElementById('sup-method').value;
    const dateTime = document.getElementById('sup-date-time').value;

    if (!name || !reason) return;

    firebase.firestore().collection('tickets').add({
        uid: currentAuthUser.uid,
        user: currentProfileData.email || currentProfileData.phone || "No Email/Phone",
        name: name,
        type: method,
        sub: `Reason: ${reason} | Pref Gender: ${gender} ${dateTime ? `| Appt Date: ${dateTime.replace('T', ' ')}` : ''}`,
        urgency: urgency,
        rep: 'Unassigned',
        status: 'Pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('sup-pref-name').value = '';
        document.getElementById('sup-reason').value = '';
        document.getElementById('sup-date-time').value = '';
        closeConfidentialSupportModal();
        showToast('Confidential support request submitted.');
    }).catch(err => showToast("Failed to submit request: " + err.message));
}

function renderUserTicketsView(snapshot) {
    // Standard users don't view full administrator table, but they can see their submissions
    console.log(`Rendered ${snapshot.size} tickets in cache.`);
}

// =========================================================
// ABUSE REPORT SUBMISSIONS (Firestore)
// =========================================================
function openReportUserModal(targetUid, targetName) {
    document.getElementById('report-target-uid').value = targetUid;
    document.getElementById('report-target-name').value = targetName;
    document.getElementById('report-reason').value = '';
    reportUserModal.classList.remove('hidden');
}

function closeReportUserModal() {
    reportUserModal.classList.add('hidden');
}

function handleReportUserSubmit(event) {
    event.preventDefault();
    const targetUid = document.getElementById('report-target-uid').value;
    const targetName = document.getElementById('report-target-name').value;
    const reason = document.getElementById('report-reason').value.trim();

    if (!reason) return;

    firebase.firestore().collection('reports').add({
        reportedUid: targetUid,
        reportedName: targetName,
        reporterUid: currentAuthUser.uid,
        reason: reason,
        status: 'pending',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        closeReportUserModal();
        showToast('Abuse report submitted. Administrators will review it shortly.');
    }).catch((err) => {
        showToast('Submission failed: ' + err.message);
    });
}

// =========================================================
// ADMINISTRATIVE PRIVILEGED OPERATIONS (Admin Portal)
// =========================================================
let adminTicketsUnsubscribe = null;
let adminUsersUnsubscribe = null;
let adminReportsUnsubscribe = null;

function initAdminViewRealTimeListeners() {
    const db = firebase.firestore();

    // 1. Unassigned or pending support tickets list
    if (adminTicketsUnsubscribe) adminTicketsUnsubscribe();
    adminTicketsUnsubscribe = db.collection('tickets')
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            renderAdminTicketsList(snapshot);
        }, (error) => console.error("Admin tickets sub failed:", error));

    // 2. Full User Registry list
    if (adminUsersUnsubscribe) adminUsersUnsubscribe();
    adminUsersUnsubscribe = db.collection('users')
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
            renderAdminUsersRegistry(snapshot);
        }, (error) => console.error("Admin users sub failed:", error));

    // 3. Received Abuse Reports list
    if (adminReportsUnsubscribe) adminReportsUnsubscribe();
    adminReportsUnsubscribe = db.collection('reports')
        .orderBy('timestamp', 'desc')
        .onSnapshot((snapshot) => {
            renderAdminAbuseReports(snapshot);
        }, (error) => console.error("Admin reports sub failed:", error));
}

function renderAdminTicketsList(snapshot) {
    const container = document.getElementById('admin-tickets-list');
    if (!container) return;
    container.innerHTML = '';

    snapshot.forEach((doc) => {
        const t = doc.data();
        const card = document.createElement('div');
        card.className = 'ticket-card-admin';
        card.innerHTML = `
            <div class="ticket-row-header">
                <div>
                    <strong>${escapeHTML(t.name || t.user)}</strong>
                    <span style="font-size:11px; color:#888;">${t.user}</span>
                </div>
                <div>
                    <span class="ticket-urgency-badge urgency-${t.urgency}">${t.urgency} Urgency</span>
                    <span class="ticket-status-badge status-${t.status.replace(' ', '-')}">${t.status}</span>
                </div>
            </div>
            <p style="font-size:13px; color:#4b5563; margin-top:6px;">${escapeHTML(t.sub)}</p>
            <div class="ticket-control-row">
                <span style="font-size:12px; font-weight:700;">Assign Rep:</span>
                <select class="admin-select" onchange="assignAdminTicketRep('${doc.id}', this.value)">
                    <option value="Unassigned" ${t.rep === 'Unassigned' ? 'selected' : ''}>Unassigned</option>
                    <option value="Sarah Jenkins" ${t.rep === 'Sarah Jenkins' ? 'selected' : ''}>Sarah Jenkins (Specialist)</option>
                    <option value="Marcus Ray" ${t.rep === 'Marcus Ray' ? 'selected' : ''}>Marcus Ray (Recovery Coach)</option>
                    <option value="Dr. Emily Vance" ${t.rep === 'Dr. Emily Vance' ? 'selected' : ''}>Dr. Emily Vance</option>
                </select>

                <span style="font-size:12px; font-weight:700; margin-left:12px;">Status:</span>
                <select class="admin-select" onchange="changeAdminTicketStatus('${doc.id}', this.value)">
                    <option value="Pending" ${t.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="Accepted" ${t.status === 'Accepted' ? 'selected' : ''}>Accepted</option>
                    <option value="In Progress" ${t.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="Completed" ${t.status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
                <button class="resolve-btn" style="margin-left:auto; background:#10b981; color:white; border:none; padding:4px 8px; border-radius:6px; cursor:pointer;" onclick="resolveTicket('${doc.id}')">Quick Complete</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function assignAdminTicketRep(ticketId, repName) {
    firebase.firestore().collection('tickets').doc(ticketId).update({ rep: repName })
        .then(() => showToast(`Assigned request to ${repName}.`))
        .catch(err => showToast("Assignment failed: " + err.message));
}

function changeAdminTicketStatus(ticketId, newStatus) {
    firebase.firestore().collection('tickets').doc(ticketId).update({ status: newStatus })
        .then(() => showToast(`Status updated to ${newStatus}.`))
        .catch(err => showToast("Status update failed: " + err.message));
}

function resolveTicket(ticketId) {
    firebase.firestore().collection('tickets').doc(ticketId).update({ status: 'Completed' })
        .then(() => showToast('Ticket resolved.'))
        .catch(err => showToast("Resolution failed: " + err.message));
}

function renderAdminUsersRegistry(snapshot) {
    const listContainer = document.getElementById('admin-users-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    // Update total count
    document.getElementById('admin-user-count').textContent = snapshot.size;

    snapshot.forEach((doc) => {
        const u = doc.data();
        const joinedDate = u.createdAt ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'N/A';
        const contact = u.email || u.phone || 'No Info';
        const isSuspended = u.suspended === true;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:8px;">${escapeHTML(u.name)}</td>
            <td style="padding:8px;">${escapeHTML(contact)}</td>
            <td style="padding:8px;">${joinedDate}</td>
            <td style="padding:8px;"><span class="status-${isSuspended ? 'Suspended' : 'Active'}">${isSuspended ? 'Suspended' : 'Active'}</span></td>
            <td style="padding:8px; text-align:right;">
                <button class="resolve-btn" style="background:${isSuspended ? '#10b981' : '#dc2626'}; color:white; border:none; padding:4px 8px; border-radius:6px; cursor:pointer;" onclick="toggleUserSuspension('${doc.id}', ${isSuspended})">
                    ${isSuspended ? 'Activate' : 'Suspend'}
                </button>
            </td>
        `;
        listContainer.appendChild(tr);
    });
}

function toggleUserSuspension(userId, currentSuspensionState) {
    firebase.firestore().collection('users').doc(userId).update({
        suspended: !currentSuspensionState
    }).then(() => {
        showToast(currentSuspensionState ? 'Account unsuspended successfully.' : 'Account suspended successfully.');
    }).catch(err => showToast("Operation failed: " + err.message));
}

function renderAdminAbuseReports(snapshot) {
    const listContainer = document.getElementById('admin-reports-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    snapshot.forEach((doc) => {
        const r = doc.data();
        const reportDate = r.timestamp ? new Date(r.timestamp.toDate()).toLocaleString() : 'N/A';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:8px;"><strong>${escapeHTML(r.reportedName)}</strong><br><span style="font-size:10.5px; color:#888;">UID: ${r.reportedUid}</span></td>
            <td style="padding:8px;"><span style="font-size:11.5px; color:#666;">UID: ${r.reporterUid}</span></td>
            <td style="padding:8px; max-width:200px; word-wrap:break-word;">${escapeHTML(r.reason)}</td>
            <td style="padding:8px;">${reportDate}</td>
            <td style="padding:8px;">
                <select class="admin-select" onchange="updateReportStatus('${doc.id}', this.value)">
                    <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="reviewed" ${r.status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
                    <option value="actioned" ${r.status === 'actioned' ? 'selected' : ''}>Actioned</option>
                </select>
            </td>
            <td style="padding:8px; text-align:right;">
                <button class="block-btn resolve-btn" style="background:#dc2626; color:white; border:none; padding:4px 8px; border-radius:6px; cursor:pointer;" data-id="${doc.id}" data-uid="${r.reportedUid}">
                    Block Target
                </button>
            </td>
        `;
        listContainer.appendChild(tr);
    });
}

function updateReportStatus(reportId, newStatus) {
    firebase.firestore().collection('reports').doc(reportId).update({
        status: newStatus
    }).then(() => {
        showToast(`Report status updated to ${newStatus}.`);
    }).catch(err => showToast("Status update failed: " + err.message));
}

// Counselor bookings scheduler
function bookCounselorAppt(event) {
    event.preventDefault();
    const spec = document.getElementById('counselor-select').value;
    const time = document.getElementById('appt-time').value;

    if (!spec || !time) return;

    firebase.firestore().collection('tickets').add({
        uid: currentAuthUser.uid,
        user: currentProfileData.email || currentProfileData.phone || "No Contact Associated",
        name: currentProfileData.name,
        type: 'Appointment Booking',
        sub: `Private 1-on-1 session with ${spec} scheduled for ${time.replace('T', ' ')}.`,
        urgency: 'Medium',
        rep: spec.split(' (')[0],
        status: 'Accepted',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        showToast(`Appointment scheduled with ${spec}!`);
    }).catch(err => showToast("Failed to book session: " + err.message));
}

// Profile modifications
function saveProfileSettings(event) {
    event.preventDefault();
    const newName = document.getElementById('prof-display-name').value.trim();
    const targetVal = parseInt(document.getElementById('prof-streak-target').value);
    const notifications = document.getElementById('prof-notif-toggle').checked;

    if (!newName) return;

    firebase.firestore().collection('users').doc(currentAuthUser.uid).update({
        name: newName,
        streakTarget: targetVal,
        notifs: notifications
    }).then(() => {
        showToast('Profile updated locally and in cloud storage.');
    }).catch(err => showToast("Failed to update profile: " + err.message));
}

// CMS Admin publications
function adminAddFaq(event) {
    event.preventDefault();
    const q = document.getElementById('cms-faq-q').value.trim();
    const a = document.getElementById('cms-faq-a').value.trim();

    if (!q || !a) return;

    firebase.firestore().collection('faqs').add({
        q: q,
        a: a,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('cms-faq-q').value = '';
        document.getElementById('cms-faq-a').value = '';
        showToast('Published FAQ article to all peers.');
    }).catch(err => showToast("FAQ creation failed: " + err.message));
}

function adminAddVideo(event) {
    event.preventDefault();
    const title = document.getElementById('cms-vid-title').value.trim();
    const desc = document.getElementById('cms-vid-desc').value.trim();

    if (!title || !desc) return;

    firebase.firestore().collection('videos').add({
        title: title,
        desc: desc,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('cms-vid-title').value = '';
        document.getElementById('cms-vid-desc').value = '';
        showToast('Embedded new instructional resource.');
    }).catch(err => showToast("Video resource creation failed: " + err.message));
}

// Dynamic FAQ render
function renderFaqList() {
    if (typeof firebase === 'undefined') return;
    firebase.firestore().collection('faqs').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
        const container = document.getElementById('faq-accordion');
        if (!container) return;
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = `<p style="font-size:13px; color:var(--text-body);">No FAQs published yet.</p>`;
            return;
        }

        snapshot.forEach((doc) => {
            const item = doc.data();
            const div = document.createElement('div');
            div.className = 'faq-item';
            div.innerHTML = `
                <button class="faq-question" onclick="toggleFaq(this)">
                    <span>${escapeHTML(item.q)}</span>
                    <span class="faq-icon">+</span>
                </button>
                <div class="faq-answer">
                    <p>${escapeHTML(item.a)}</p>
                </div>
            `;
            container.appendChild(div);
        });
    });
}

function toggleFaq(btn) {
    btn.parentElement.classList.toggle('open');
}

// Dynamic Video render
function renderVideosGrid() {
    if (typeof firebase === 'undefined') return;
    firebase.firestore().collection('videos').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
        const container = document.getElementById('videos-grid-list');
        if (!container) return;
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = `<p style="font-size:13px; color:var(--text-body);">No video guides published yet.</p>`;
            return;
        }

        snapshot.forEach((doc) => {
            const v = doc.data();
            const card = document.createElement('div');
            card.className = 'video-card';
            card.innerHTML = `
                <div class="video-thumbnail-trigger" onclick="openVideoModal('${escapeHTML(v.title)}', '${escapeHTML(v.desc)}')">
                    <div class="vplay-icon">▶</div>
                </div>
                <div class="video-info-box">
                    <h4>${escapeHTML(v.title)}</h4>
                    <p>${escapeHTML(v.desc)}</p>
                </div>
            `;
            container.appendChild(card);
        });
    });
}

function filterResources() {
    const q = document.getElementById('resource-search').value.toLowerCase();
    document.querySelectorAll('#faq-accordion .faq-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? 'block' : 'none';
    });
    document.querySelectorAll('#videos-grid-list .video-card').forEach(card => {
        card.style.display = card.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    });
}

// =========================================================
// AI CHATBOT SYSTEM (Intent Matcher & Crisis Router)
// =========================================================
let isAiOpen = false;

function toggleAiWidget() {
    isAiOpen = !isAiOpen;
    const widget = document.getElementById('ai-chat-widget');
    if (isAiOpen) {
        widget.classList.remove('hidden');
    } else {
        widget.classList.add('hidden');
    }
}

function handleAiMessageSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('ai-user-input');
    const txt = input.value;
    if (!txt.trim()) return;

    appendAiChatMessage(txt, 'user');
    input.value = '';

    setTimeout(() => {
        const reply = getAiResponse(txt);
        appendAiChatMessage(reply, 'bot');
    }, 800);
}

function appendAiChatMessage(text, sender) {
    const list = document.getElementById('ai-messages-list');
    const div = document.createElement('div');
    div.className = `ai-msg ${sender}`;
    div.textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

function getAiResponse(msg) {
    const val = msg.toLowerCase();

    if (val.includes('suicide') || val.includes('kill') || val.includes('hurt myself') || val.includes('give up') || val.includes('relapse') || val.includes('hopeless') || val.includes('crisis')) {
        return "🚨 If you are feeling overwhelmed, please know that your life is extremely valuable. I recommend opening our 'Need Immediate Help?' card or calling the SAMHSA crisis line at 1-800-662-4357 right now. Free, confidential support is available 24/7.";
    }
    if (val.includes('breath') || val.includes('anxious') || val.includes('relax') || val.includes('calm') || val.includes('meditat')) {
        return "🧘‍♂️ Let's practice Box Breathing together. Inhale deeply through your nose for 4 seconds... Hold your breath for 4 seconds... Exhale slowly for 4 seconds... Hold empty for 4 seconds. Repeat this 3 times to soothe your nervous system.";
    }
    if (val.includes('recovery') || val.includes('addiction') || val.includes('crave') || val.includes('trigger')) {
        return "✨ Recovery is a path built on small daily choices. Cravings are normal impulse waves—they usually last only 10 to 15 minutes. Try changing your environment, drinking cold water, or journaling your triggers to ride out the wave.";
    }
    if (val.includes('help') || val.includes('counselor') || val.includes('talk')) {
        return "💬 Connecting with a supportive human makes a massive difference. You can click 'Request Support Form' in the header to get assigned to a counselor, or join our live Peer Support Circles today.";
    }
    return "🌿 You are doing incredibly well on this journey. Remember to focus on one single step today. How else can I assist you with wellness tips or daily habit advice?";
}

// Error & Helpers
function showAuthError(msg) {
    authErrorBox.textContent = msg;
    authErrorBox.classList.remove('hidden');
}

function hideAuthError() {
    authErrorBox.textContent = '';
    authErrorBox.classList.add('hidden');
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 3500);
}

// Checkbox and Mood support triggers
function selectMood(moodLabel, emoji) {
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    const moodStatus = document.getElementById('mood-status');
    moodStatus.textContent = `Log saved: Feeling ${moodLabel} ${emoji}`;
    moodStatus.classList.remove('hidden');

    const motivTitle = document.getElementById('motiv-title');
    const motivDesc = document.getElementById('motiv-desc');

    if (moodLabel === 'Stressed' || moodLabel === 'Low') {
        motivTitle.textContent = `It is completely okay to feel ${moodLabel.toLowerCase()} today.`;
        motivDesc.textContent = `Remember that healing isn't linear. Be gentle with yourself—you are doing great simply by being here.`;
    } else {
        motivTitle.textContent = `Wonderful! Keep this positive energy flowing.`;
        motivDesc.textContent = `Your consistency is unlocking newfound clarity and strength every single day.`;
    }
    showToast(`Mood logged as ${moodLabel} ${emoji}`);
}

function completeTask(taskElem) {
    taskElem.classList.toggle('done');
    if (taskElem.classList.contains('done')) showToast('Step completed! Beautiful progress 🌿');
}

function toggleHabit(checkbox) {
    const textSpan = checkbox.parentElement.querySelector('span:last-child');
    textSpan.style.textDecoration = checkbox.checked ? 'line-through' : 'none';
    textSpan.style.opacity = checkbox.checked ? '0.6' : '1';
    if (checkbox.checked) showToast('Habit completed! Keep it up 💪');
}

function selectTag(btn) {
    document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedEmotionTag = btn.textContent;
}

// Event Delegation for dynamically generated abuse reports block buttons
const reportsListContainer = document.getElementById('admin-reports-list');
if (reportsListContainer) {
    reportsListContainer.addEventListener('click', (e) => {
        const blockBtn = e.target.closest('.block-btn');
        if (blockBtn) {
            const reportId = blockBtn.getAttribute('data-id');
            const reportedUid = blockBtn.getAttribute('data-uid');
            
            // Suspend the reported user
            toggleUserSuspension(reportedUid, false);
            // Mark the report as actioned
            updateReportStatus(reportId, 'actioned');
        }
    });
}
