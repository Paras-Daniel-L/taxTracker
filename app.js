/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║                    DORM TAX TRACKER                          ║
 * ║            app.js — Firebase + Application Logic             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Firestore Collections:
 *
 *  payments  { weekNumber, month, year, weekName(compat),
 *              payerEmail, payerName, status,
 *              witnessName, amount, timestamp }
 *
 *  expenses  { description, buyerName, buyerEmail,
 *              amount, timestamp }
 *
 *  settings  { budget: { baseBalance } }
 */

// ╔══════════════════════════════════════════════════════════════╗
// ║  1.  FIREBASE CONFIG  ← PASTE YOUR CONFIG OBJECT HERE       ║
// ║                                                              ║
// ║  How to get it:                                              ║
// ║   Firebase Console → Project Settings → Your Apps           ║
// ║   → Web App → SDK setup and configuration → Config          ║
// ╚══════════════════════════════════════════════════════════════╝
const firebaseConfig = {
  apiKey: "AIzaSyC8ZAtVqAesO6mEOw0qgt2AiW6fi6_jL_E",
  authDomain: "taxtracker-31326.firebaseapp.com",
  projectId: "taxtracker-31326",
  storageBucket: "taxtracker-31326.firebasestorage.app",
  messagingSenderId: "98752140729",
  appId: "1:98752140729:web:281a7d54c3d7ab379f5268"
};
// ══════════════════════════════════════════════════════════════

// ╔══════════════════════════════════════════════════════════════╗
// ║  2.  EMAIL → DISPLAY NAME MAP                                ║
// ║                                                              ║
// ║  Add every roommate's exact login email (lowercase) and      ║
// ║  the name you want displayed in the app.                     ║
// ╚══════════════════════════════════════════════════════════════╝
const EMAIL_TO_NAME = {
  "daniel@dorm.com": "Daniel",
  "shad@dorm.com":   "Shad",
  "joe@dorm.com":    "Joe",
  "kurt@dorm.com":   "Kurt",
  // "roommate@gmail.com": "Roommate",   ← add more here
};

/** The canonical list of all dorm members (derived from EMAIL_TO_NAME). */
const MASTER_USERS = Object.values(EMAIL_TO_NAME); // ["Daniel", "Shad", "Joe", "Kurt"]
// ══════════════════════════════════════════════════════════════

// ╔══════════════════════════════════════════════════════════════╗
// ║  3.  CONSTANTS                                               ║
// ╚══════════════════════════════════════════════════════════════╝
const TAX_AMOUNT = 50; // ₱ per week — always constant

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// ══════════════════════════════════════════════════════════════


// ──────────────────────────────────────────────────────────────
//  Firebase SDK imports (CDN — no npm required)
// ──────────────────────────────────────────────────────────────
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ──────────────────────────────────────────────────────────────
//  Validate config before initialising (friendly dev warning)
// ──────────────────────────────────────────────────────────────
if (firebaseConfig.apiKey === "YOUR_API_KEY") {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
                min-height:100dvh;background:#0D0F1A;padding:24px;">
      <div style="max-width:420px;background:#1C1F35;border:1px solid rgba(245,158,11,0.35);
                  border-radius:18px;padding:32px;color:#EEF0FF;font-family:system-ui;">
        <h2 style="color:#F59E0B;margin-bottom:12px;">⚙️ Setup Required</h2>
        <p style="color:#9197B3;line-height:1.6;font-size:14px;">
          Open <code style="color:#FCD34D;">app.js</code> and replace the placeholder
          <code style="color:#FCD34D;">firebaseConfig</code> object (section 1) with
          your real Firebase project credentials.<br><br>
          You can find them at:<br>
          <strong>Firebase Console → Project Settings → Your Apps → Config</strong>
        </p>
      </div>
    </div>`;
  throw new Error("Firebase config is not configured. See app.js section 1.");
}


// ──────────────────────────────────────────────────────────────
//  Initialise Firebase
// ──────────────────────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);


// ──────────────────────────────────────────────────────────────
//  App State
// ──────────────────────────────────────────────────────────────
let currentUser        = null;  // Firebase User object
let baseBalance        = 0;     // From Firestore settings/budget
let verifiedTotal      = 0;     // Sum of verified payment amounts
let expensesTotal      = 0;     // Sum of all expense amounts
let cachedPayments     = [];    // Live copy — used for rendering & duplicate guard
let reminderDismissed  = false; // Session-only dismiss flag

let selectedMonth = new Date().getMonth();   // 0-indexed (0 = January)
let selectedYear  = new Date().getFullYear();

let unsubPayments  = null;
let unsubExpenses  = null;
let unsubSettings  = null;


// ──────────────────────────────────────────────────────────────
//  DOM References
// ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const loadingView             = $("loading-view");
const loginView               = $("login-view");
const dashboardView           = $("dashboard-view");
const loginForm               = $("login-form");
const loginErrorEl            = $("login-error");
const loginBtn                = $("login-btn");
const logoutBtn               = $("logout-btn");
const userAvatarEl            = $("user-avatar");
const userNameEl              = $("user-name-display");
const budgetAmountEl          = $("budget-amount");
const statIncomeEl            = $("stat-income");
const statExpensesEl          = $("stat-expenses");
const statBaseEl              = $("stat-base");
const editBudgetBtn           = $("edit-budget-btn");
const monthSelectEl           = $("month-select");
const yearSelectEl            = $("year-select");
const weekBlocksContainerEl   = $("week-blocks-container");
const legacyContainerEl       = $("legacy-payments-container");
const reminderBannerEl        = $("reminder-banner");
const reminderTextEl          = $("reminder-text");
const dismissReminderBtn      = $("dismiss-reminder");
const expenseFormEl           = $("expense-form");
const expenseDescEl           = $("expense-desc");
const expenseAmtEl            = $("expense-amount");
const addExpenseBtnEl         = $("add-expense-btn");
const expenseErrorEl          = $("expense-error");
const expensesListEl          = $("expenses-list");
const toastEl                 = $("toast");


// ──────────────────────────────────────────────────────────────
//  Helper Utilities
// ──────────────────────────────────────────────────────────────

/** Map an email to a display name. */
function getDisplayName(email) {
  if (!email) return "Unknown";
  const hit = EMAIL_TO_NAME[email.trim().toLowerCase()];
  if (hit) return hit;
  const username = email.split("@")[0];
  return username.charAt(0).toUpperCase() + username.slice(1);
}

/** Format a number as Philippine Peso. */
function fmt(amount) {
  return "₱" + Number(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Format a Firestore Timestamp or JS Date as "Mon DD, YYYY". */
function fmtDate(ts) {
  if (!ts?.toDate) return "Just now";
  return ts.toDate().toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/** Escape user-provided strings before inserting as innerHTML. */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Translate Firebase Auth error codes to friendly messages. */
function friendlyAuthError(code) {
  const MAP = {
    "auth/invalid-email":          "That doesn't look like a valid email address.",
    "auth/user-not-found":         "No account found with this email.",
    "auth/wrong-password":         "Incorrect password. Please try again.",
    "auth/invalid-credential":     "Invalid email or password.",
    "auth/too-many-requests":      "Too many failed attempts — please wait a moment.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/user-disabled":          "This account has been disabled. Contact the dorm admin.",
  };
  return MAP[code] ?? "Login failed. Please check your credentials and try again.";
}

// Toast
let _toastTimer;
function showToast(msg, type = "info") {
  clearTimeout(_toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type} show`;
  _toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

/**
 * Returns how many weeks (4 or 5) are in a given month.
 * Definition: Week 1 = days 1–7, Week 2 = days 8–14, etc.
 * Any remaining days (29–31) become Week 5.
 * @param {number} year  - full year, e.g. 2026
 * @param {number} month - 0-indexed (0 = January)
 */
function getWeeksInMonth(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return daysInMonth > 28 ? 5 : 4;
}


// ──────────────────────────────────────────────────────────────
//  Populate Month / Year Dropdowns
// ──────────────────────────────────────────────────────────────
(function populateMonthYear() {
  MONTH_NAMES.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value       = i;
    opt.textContent = name;
    if (i === selectedMonth) opt.selected = true;
    monthSelectEl.appendChild(opt);
  });

  const cy = new Date().getFullYear();
  for (let y = cy - 1; y <= cy + 1; y++) {
    const opt = document.createElement("option");
    opt.value       = y;
    opt.textContent = y;
    if (y === selectedYear) opt.selected = true;
    yearSelectEl.appendChild(opt);
  }
})();

monthSelectEl.addEventListener("change", () => {
  selectedMonth = parseInt(monthSelectEl.value, 10);
  renderWeekBlocks();
});

yearSelectEl.addEventListener("change", () => {
  selectedYear = parseInt(yearSelectEl.value, 10);
  renderWeekBlocks();
});


// ──────────────────────────────────────────────────────────────
//  Auth State Listener  (drives view switching)
// ──────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  loadingView.hidden = true;

  if (user) {
    currentUser = user;
    showDashboard();
  } else {
    currentUser = null;
    showLogin();
  }
});


// ──────────────────────────────────────────────────────────────
//  View: Login
// ──────────────────────────────────────────────────────────────
function showLogin() {
  loginView.hidden     = false;
  dashboardView.hidden = true;
  teardownListeners();
  loginForm.reset();
  hideLoginError();
}

function showLoginError(msg) {
  loginErrorEl.textContent = msg;
  loginErrorEl.classList.add("visible");
}

function hideLoginError() {
  loginErrorEl.textContent = "";
  loginErrorEl.classList.remove("visible");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideLoginError();

  const email    = $("email-input").value.trim();
  const password = $("password-input").value;

  if (!email || !password) {
    showLoginError("Please enter both your email and password.");
    return;
  }

  loginBtn.disabled    = true;
  loginBtn.textContent = "Signing in…";

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the transition
  } catch (err) {
    console.error("[Auth]", err.code, err.message);
    showLoginError(friendlyAuthError(err.code));
    loginBtn.disabled    = false;
    loginBtn.textContent = "Sign In";
  }
});


// ──────────────────────────────────────────────────────────────
//  View: Dashboard
// ──────────────────────────────────────────────────────────────
function showDashboard() {
  loginView.hidden     = true;
  dashboardView.hidden = false;

  const name = getDisplayName(currentUser.email);
  userNameEl.textContent   = name;
  userAvatarEl.textContent = name.charAt(0).toUpperCase();

  reminderDismissed = false;
  activateTab("payments");
  setupListeners();
}

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[Auth] signOut failed:", err);
  }
});


// ──────────────────────────────────────────────────────────────
//  Tab Switching
// ──────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

function activateTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const isActive = b.dataset.tab === tabName;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.hidden = pane.id !== `${tabName}-tab`;
  });
}


// ──────────────────────────────────────────────────────────────
//  Budget Calculation & Display
// ──────────────────────────────────────────────────────────────
function updateBudget() {
  const budget = baseBalance + verifiedTotal - expensesTotal;

  budgetAmountEl.textContent = fmt(budget);
  budgetAmountEl.className =
    budget > 0 ? "budget-amount pos"
    : budget < 0 ? "budget-amount neg"
    : "budget-amount neu";

  statIncomeEl.textContent   = fmt(verifiedTotal);
  statExpensesEl.textContent = fmt(expensesTotal);
  statBaseEl.textContent     = fmt(baseBalance);
}

// Edit Budget — opens a prompt to set the cash-on-hand base balance
editBudgetBtn.addEventListener("click", async () => {
  const current = baseBalance;
  const input   = window.prompt(
    `Enter the current cash on hand (base balance):\nThis will be added to verified payments.\n\nCurrent base: ₱${current}`,
    current
  );

  if (input === null) return; // user cancelled

  const amount = parseFloat(input);
  if (isNaN(amount) || amount < 0) {
    showToast("Please enter a valid non-negative number.", "error");
    return;
  }

  try {
    await setDoc(doc(db, "settings", "budget"), { baseBalance: amount }, { merge: true });
    showToast("Base balance updated ✓", "success");
  } catch (err) {
    console.error("[Firestore] editBudget:", err);
    showToast("Failed to update balance. Check your connection.", "error");
  }
});


// ──────────────────────────────────────────────────────────────
//  Reminder Banner — check if user has unpaid weeks this month
// ──────────────────────────────────────────────────────────────
function checkAndShowReminder() {
  if (reminderDismissed || !currentUser) return;

  const now        = new Date();
  const curMonth   = MONTH_NAMES[now.getMonth()];
  const curYear    = now.getFullYear();
  const numWeeks   = getWeeksInMonth(curYear, now.getMonth());
  const userEmail  = currentUser.email.toLowerCase();

  const unpaidWeeks = [];

  for (let w = 1; w <= numWeeks; w++) {
    const hasPaid = cachedPayments.some(
      (p) =>
        p.weekNumber === w &&
        p.month === curMonth &&
        p.year === curYear &&
        p.payerEmail?.toLowerCase() === userEmail
    );
    if (!hasPaid) unpaidWeeks.push(w);
  }

  if (unpaidWeeks.length > 0) {
    const weekList = unpaidWeeks.length === 1
      ? `Week ${unpaidWeeks[0]}`
      : `Weeks ${unpaidWeeks.join(", ")}`;
    reminderTextEl.textContent = `⚠ Reminder: You have unpaid taxes for ${weekList} of ${curMonth}!`;
    reminderBannerEl.hidden = false;
  } else {
    reminderBannerEl.hidden = true;
  }
}

dismissReminderBtn.addEventListener("click", () => {
  reminderDismissed      = true;
  reminderBannerEl.hidden = true;
});


// ──────────────────────────────────────────────────────────────
//  Payments — Mark as Paid for a Specific Week
// ──────────────────────────────────────────────────────────────
async function markPaidForWeek(weekNumber, btn) {
  const monthName = MONTH_NAMES[selectedMonth];

  // Duplicate guard: one payment per user per week per month/year
  const alreadyPaid = cachedPayments.some(
    (p) =>
      p.weekNumber === weekNumber &&
      p.month === monthName &&
      p.year === selectedYear &&
      p.payerEmail?.toLowerCase() === currentUser.email.toLowerCase()
  );

  if (alreadyPaid) {
    showToast(`You already paid for Week ${weekNumber} of ${monthName}.`, "error");
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    await addDoc(collection(db, "payments"), {
      weekNumber,                       // integer: 1–5
      month:      monthName,            // e.g. "May"
      year:       selectedYear,         // e.g. 2026
      weekName:   `Week ${weekNumber}`, // backward-compat label
      payerEmail: currentUser.email,
      payerName:  getDisplayName(currentUser.email),
      status:     "pending",
      witnessName: null,
      amount:     TAX_AMOUNT,
      timestamp:  serverTimestamp(),
    });
    showToast(`Week ${weekNumber} of ${monthName} marked as paid ✓`, "success");
  } catch (err) {
    console.error("[Firestore] markPaid:", err);
    showToast("Failed to save. Check your connection.", "error");
    if (btn) { btn.disabled = false; btn.textContent = `Pay ₱${TAX_AMOUNT}`; }
  }
}


// ──────────────────────────────────────────────────────────────
//  Payments — Witness a Payment
// ──────────────────────────────────────────────────────────────
async function witnessPayment(paymentId, btn) {
  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    await updateDoc(doc(db, "payments", paymentId), {
      status:      "verified",
      witnessName: getDisplayName(currentUser.email),
    });
    showToast("Payment witnessed ✓", "success");
  } catch (err) {
    console.error("[Firestore] witness:", err);
    showToast("Could not verify payment. Try again.", "error");
    btn.disabled    = false;
    btn.textContent = "✓ Witness";
  }
}


// ──────────────────────────────────────────────────────────────
//  Payments — Cancel (delete) a Pending Payment
// ──────────────────────────────────────────────────────────────
async function cancelPayment(paymentId, btn) {
  if (!window.confirm("Cancel this payment? This action cannot be undone.")) return;

  btn.disabled    = true;
  btn.textContent = "Cancelling…";

  try {
    await deleteDoc(doc(db, "payments", paymentId));
    showToast("Payment cancelled.", "info");
  } catch (err) {
    console.error("[Firestore] cancelPayment:", err);
    showToast("Failed to cancel payment. Try again.", "error");
    btn.disabled    = false;
    btn.textContent = "✕ Cancel";
  }
}


// ──────────────────────────────────────────────────────────────
//  Payments — Render a Single Payment Card (HTML string)
// ──────────────────────────────────────────────────────────────
function renderPaymentCard(p) {
  const isOwnPayment = p.payerEmail?.toLowerCase() === currentUser?.email?.toLowerCase();
  const isPending    = p.status === "pending";

  // Witness / Cancel actions
  let actionsHtml = "";
  if (isPending) {
    if (isOwnPayment) {
      actionsHtml = `
        <button class="btn-witness" disabled title="You cannot witness your own payment">
          🔒 Own
        </button>
        <button class="btn-cancel" data-id="${esc(p.id)}" title="Cancel your pending payment">
          ✕ Cancel
        </button>`;
    } else {
      actionsHtml = `
        <button class="btn-witness" data-id="${esc(p.id)}" title="Witness this payment">
          ✓ Witness
        </button>`;
    }
  }

  const witnessLabel = (p.status === "verified" && p.witnessName)
    ? ` · by ${esc(p.witnessName)}`
    : "";

  const statusIcon = p.status === "verified" ? "✓" : "⏳";
  const statusText = p.status === "verified" ? "Verified" : "Pending";

  return `
    <div class="payment-card ${esc(p.status)}">
      <div class="pc-row1">
        <span class="payer-name">${esc(p.payerName)}</span>
        <span class="pay-amount">${fmt(p.amount ?? TAX_AMOUNT)}</span>
      </div>
      <div class="pc-row2">
        <span class="badge ${esc(p.status)}">${statusIcon} ${statusText}${witnessLabel}</span>
        <div class="pc-row2-actions">${actionsHtml}</div>
      </div>
    </div>`;
}


// ──────────────────────────────────────────────────────────────
//  Payments — Render Week Blocks for the Selected Month / Year
// ──────────────────────────────────────────────────────────────
function renderWeekBlocks() {
  const monthName = MONTH_NAMES[selectedMonth];
  const numWeeks  = getWeeksInMonth(selectedYear, selectedMonth);

  // Payments belonging to the selected month and year
  const monthPayments = cachedPayments.filter(
    (p) => p.month === monthName && p.year === selectedYear
  );

  // Build week blocks
  weekBlocksContainerEl.innerHTML = "";

  for (let w = 1; w <= numWeeks; w++) {
    const weekPayments = monthPayments.filter((p) => p.weekNumber === w);
    const paidNames    = weekPayments.map((p) => p.payerName);
    const unpaidNames  = MASTER_USERS.filter((name) => !paidNames.includes(name));
    const isComplete   = unpaidNames.length === 0;
    const userPaid     = weekPayments.some(
      (p) => p.payerEmail?.toLowerCase() === currentUser?.email?.toLowerCase()
    );

    const statusClass = isComplete ? "complete" : "incomplete";
    const statusIcon  = isComplete ? "✓" : "⚠";
    const statusLabel = isComplete
      ? `Complete (${paidNames.length}/${MASTER_USERS.length} Paid)`
      : `Incomplete (${paidNames.length}/${MASTER_USERS.length} Paid)`;

    const unpaidHtml = unpaidNames.length
      ? `<div class="unpaid-names"><strong>Still owes:</strong> ${unpaidNames.map(esc).join(", ")}</div>`
      : "";

    const payBtnHtml = !userPaid
      ? `<button class="btn-pay-week" data-week="${w}" data-month="${esc(monthName)}" data-year="${selectedYear}">
           Pay ₱${TAX_AMOUNT}
         </button>`
      : "";

    const block = document.createElement("div");
    block.className = "week-block";
    block.innerHTML = `
      <div class="week-block-hdr">
        <div class="week-block-meta">
          <div class="week-block-title">Week ${w}</div>
          <div class="week-status ${statusClass}">${statusIcon} ${statusLabel}</div>
          ${unpaidHtml}
        </div>
        ${payBtnHtml}
      </div>
      <div class="week-payment-cards">
        ${weekPayments.map(renderPaymentCard).join("")}
      </div>`;

    weekBlocksContainerEl.appendChild(block);
  }

  // If there are no payments at all for this month, show a subtle hint inside the last block
  if (monthPayments.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.innerHTML = `
      <div class="empty-icon">💸</div>
      <div class="empty-title">No payments for ${monthName} ${selectedYear}</div>
      <div class="empty-sub">Click "Pay ₱50" on a week block above to get started</div>`;
    weekBlocksContainerEl.appendChild(hint);
  }

  // ── Attach event listeners ─────────────────────────────────

  // Pay buttons
  weekBlocksContainerEl.querySelectorAll(".btn-pay-week").forEach((btn) => {
    btn.addEventListener("click", () => {
      markPaidForWeek(parseInt(btn.dataset.week, 10), btn);
    });
  });

  // Witness buttons
  weekBlocksContainerEl.querySelectorAll(".btn-witness[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => witnessPayment(btn.dataset.id, btn));
  });

  // Cancel buttons
  weekBlocksContainerEl.querySelectorAll(".btn-cancel[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => cancelPayment(btn.dataset.id, btn));
  });

  // Also render legacy payments (old schema without month/year)
  renderLegacyPayments();
}


// ──────────────────────────────────────────────────────────────
//  Legacy Payments — old schema entries without month/year
// ──────────────────────────────────────────────────────────────
function renderLegacyPayments() {
  const legacyPayments = cachedPayments.filter(
    (p) => !p.month || !p.year || !p.weekNumber
  );

  if (!legacyPayments.length) {
    legacyContainerEl.innerHTML = "";
    return;
  }

  // Group by weekName
  const groups = {};
  legacyPayments.forEach((p) => {
    const key = p.weekName || "Unknown Week";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  const sortedWeeks = Object.keys(groups).sort((a, b) => {
    const nA = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const nB = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return nB - nA;
  });

  legacyContainerEl.innerHTML = `
    <div class="legacy-section">
      <div class="legacy-hdr">Previous Records (no month/year)</div>
      ${sortedWeeks.map((week) => `
        <div class="legacy-week-group">
          <div class="legacy-week-label">${esc(week)}</div>
          ${groups[week].map(renderPaymentCard).join("")}
        </div>
      `).join("")}
    </div>`;

  // Attach listeners for legacy cards
  legacyContainerEl.querySelectorAll(".btn-witness[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => witnessPayment(btn.dataset.id, btn));
  });
  legacyContainerEl.querySelectorAll(".btn-cancel[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => cancelPayment(btn.dataset.id, btn));
  });
}


// ──────────────────────────────────────────────────────────────
//  Expenses — Add Expense
// ──────────────────────────────────────────────────────────────
expenseFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  expenseErrorEl.classList.remove("visible");

  const desc   = expenseDescEl.value.trim();
  const amount = parseFloat(expenseAmtEl.value);

  if (!desc) {
    expenseErrorEl.textContent = "Please enter a description for the expense.";
    expenseErrorEl.classList.add("visible");
    expenseDescEl.focus();
    return;
  }

  if (isNaN(amount) || amount <= 0) {
    expenseErrorEl.textContent = "Please enter a valid amount greater than ₱0.";
    expenseErrorEl.classList.add("visible");
    expenseAmtEl.focus();
    return;
  }

  addExpenseBtnEl.disabled    = true;
  addExpenseBtnEl.textContent = "Adding…";

  try {
    await addDoc(collection(db, "expenses"), {
      description: desc,
      buyerName:   getDisplayName(currentUser.email),
      buyerEmail:  currentUser.email,   // ← stored for delete-own-expense rule
      amount,
      timestamp:   serverTimestamp(),
    });
    expenseFormEl.reset();
    showToast("Expense logged ✓", "success");
  } catch (err) {
    console.error("[Firestore] addExpense:", err);
    expenseErrorEl.textContent = "Failed to save expense. Check your connection.";
    expenseErrorEl.classList.add("visible");
  } finally {
    addExpenseBtnEl.disabled    = false;
    addExpenseBtnEl.textContent = "+ Add";
  }
});


// ──────────────────────────────────────────────────────────────
//  Expenses — Delete an Expense (owner only)
// ──────────────────────────────────────────────────────────────
async function deleteExpense(expenseId, btn) {
  if (!window.confirm("Delete this expense? This cannot be undone.")) return;

  btn.disabled    = true;
  btn.textContent = "Deleting…";

  try {
    await deleteDoc(doc(db, "expenses", expenseId));
    showToast("Expense deleted.", "info");
  } catch (err) {
    console.error("[Firestore] deleteExpense:", err);
    showToast("Failed to delete. Try again.", "error");
    btn.disabled    = false;
    btn.textContent = "🗑 Delete";
  }
}


// ──────────────────────────────────────────────────────────────
//  Expenses — Render
// ──────────────────────────────────────────────────────────────
function renderExpenses(expenses) {
  if (!expenses.length) {
    expensesListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <div class="empty-title">No expenses logged</div>
        <div class="empty-sub">Add your first shared expense above</div>
      </div>`;
    return;
  }

  expensesListEl.innerHTML = expenses.map((e) => {
    const isOwn = e.buyerEmail?.toLowerCase() === currentUser?.email?.toLowerCase();
    const deleteBtn = isOwn
      ? `<button class="btn-delete-expense" data-id="${esc(e.id)}" title="Delete this expense">🗑 Delete</button>`
      : "";

    return `
      <div class="expense-card">
        <div class="ec-row1">
          <span class="exp-description">${esc(e.description)}</span>
          <span class="exp-debit">-${fmt(e.amount)}</span>
        </div>
        <div class="ec-row2">
          <span class="exp-buyer">by ${esc(e.buyerName)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="exp-date">${fmtDate(e.timestamp)}</span>
            ${deleteBtn}
          </div>
        </div>
      </div>`;
  }).join("");

  // Attach delete listeners
  expensesListEl.querySelectorAll(".btn-delete-expense[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => deleteExpense(btn.dataset.id, btn));
  });
}


// ──────────────────────────────────────────────────────────────
//  Real-Time Firestore Listeners
// ──────────────────────────────────────────────────────────────

/** Subscribe to the settings/budget document for baseBalance. */
function setupSettingsListener() {
  const settingsRef = doc(db, "settings", "budget");

  unsubSettings = onSnapshot(
    settingsRef,
    (snap) => {
      baseBalance = snap.exists() ? (Number(snap.data().baseBalance) || 0) : 0;
      updateBudget();
    },
    (err) => {
      console.error("[Firestore] settings onSnapshot error:", err);
    }
  );
}

/** Subscribe to the payments collection (ordered newest-first). */
function setupPaymentsListener() {
  const q = query(collection(db, "payments"), orderBy("timestamp", "desc"));

  unsubPayments = onSnapshot(
    q,
    (snapshot) => {
      const payments  = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      cachedPayments  = payments;

      // Only verified payments count toward income
      verifiedTotal = payments
        .filter((p) => p.status === "verified")
        .reduce((sum, p) => sum + (Number(p.amount) || TAX_AMOUNT), 0);

      updateBudget();
      renderWeekBlocks();
      checkAndShowReminder();
    },
    (err) => {
      console.error("[Firestore] payments onSnapshot error:", err);
      showToast("Failed to load payments. Check your connection.", "error");
    }
  );
}

/** Subscribe to the expenses collection (ordered newest-first). */
function setupExpensesListener() {
  const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));

  unsubExpenses = onSnapshot(
    q,
    (snapshot) => {
      const expenses = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      expensesTotal = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      updateBudget();
      renderExpenses(expenses);
    },
    (err) => {
      console.error("[Firestore] expenses onSnapshot error:", err);
      showToast("Failed to load expenses. Check your connection.", "error");
    }
  );
}

/** Start all real-time listeners when user logs in. */
function setupListeners() {
  setupSettingsListener();
  setupPaymentsListener();
  setupExpensesListener();
}

/** Unsubscribe all listeners and reset state when user logs out. */
function teardownListeners() {
  if (unsubSettings) { unsubSettings(); unsubSettings = null; }
  if (unsubPayments) { unsubPayments(); unsubPayments = null; }
  if (unsubExpenses) { unsubExpenses(); unsubExpenses = null; }

  cachedPayments = [];
  baseBalance    = 0;
  verifiedTotal  = 0;
  expensesTotal  = 0;
  updateBudget();
}


/*
 * ════════════════════════════════════════════════════════════════
 *  FIRESTORE SECURITY RULES  (deploy via Firebase Console or CLI)
 *
 *  Place the rules below in your firestore.rules file:
 * ════════════════════════════════════════════════════════════════
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *
 *     function isSignedIn() {
 *       return request.auth != null;
 *     }
 *
 *     function isOwnerEmail(field) {
 *       return resource.data[field] == request.auth.token.email;
 *     }
 *
 *     // Payments collection
 *     match /payments/{paymentId} {
 *       allow read:   if isSignedIn();
 *       // Only the payer can create their own payment record
 *       allow create: if isSignedIn()
 *                     && request.resource.data.payerEmail == request.auth.token.email;
 *       // Any signed-in user can update (to witness); witnessing is validated client-side
 *       allow update: if isSignedIn();
 *       // Only the payer can cancel, and only while status is still 'pending'
 *       allow delete: if isSignedIn()
 *                     && isOwnerEmail("payerEmail")
 *                     && resource.data.status == "pending";
 *     }
 *
 *     // Expenses collection
 *     match /expenses/{expenseId} {
 *       allow read:   if isSignedIn();
 *       // Only the buyer can create their own expense
 *       allow create: if isSignedIn()
 *                     && request.resource.data.buyerEmail == request.auth.token.email;
 *       allow update: if false; // expenses are immutable once logged
 *       // Only the buyer can delete their own expense
 *       allow delete: if isSignedIn() && isOwnerEmail("buyerEmail");
 *     }
 *
 *     // Settings (base balance) — any authenticated user can read/write
 *     match /settings/{document} {
 *       allow read, write: if isSignedIn();
 *     }
 *   }
 * }
 */
