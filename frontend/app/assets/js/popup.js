import * as enums from './enums.js';
import { commHandler } from './commHandler.js';
import { storageHandler } from './storageHandler.js';
import { scrapingHandler } from './scrapingHandler.js';
import { log } from './log.js';

log.info("popup.js: has been started.");

// --- Element References ---
let mutedUserCountSpan;
let refreshMutedListButton;
let exportMutedListCSVButton;
let popupStatusDiv;

// --- Helper Functions ---

/**
 * Updates the status message area.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, style as an error.
 * @param {number} clearAfterMs - Milliseconds after which to clear the message (0 = don't clear).
 */
function updateStatus(message, isError = false, clearAfterMs = 3000) {
  if (!popupStatusDiv) return;
  popupStatusDiv.textContent = message;
  popupStatusDiv.style.color = isError ? '#dc3545' : '#333'; // Red for error, dark grey otherwise

  // Clear the message after a delay
  if (clearAfterMs > 0) {
    setTimeout(() => {
      if (popupStatusDiv.textContent === message) { // Only clear if it hasn't been overwritten
        popupStatusDiv.textContent = '';
      }
    }, clearAfterMs);
  }
}

/**
 * Generates a CSV file from the username list and triggers download.
 * @param {string[]} usernames - Array of usernames.
 */
function downloadCSV(usernames) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    updateStatus("No usernames to export.", true);
    return;
  }

  const csvHeader = "Username\n";
  const csvContent = csvHeader + usernames.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  link.setAttribute("download", `eksiengel_muted_users_${timestamp}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  updateStatus("Muted user list exported.", false);
}

// --- Initialization ---

async function initializePopup() {
  log.info("popup.js: Initializing...");

  // Get element references
  mutedUserCountSpan = document.getElementById('mutedUserCount');
  refreshMutedListButton = document.getElementById('refreshMutedList');
  exportMutedListCSVButton = document.getElementById('exportMutedListCSV');
  popupStatusDiv = document.getElementById('popupStatus');

  // Set initial count from storage
  try {
    const count = await storageHandler.getMutedUserCount();
    mutedUserCountSpan.textContent = count;
    exportMutedListCSVButton.disabled = count === 0;
  } catch (error) {
    log.err("popup.js", "Error getting initial muted count:", error);
    mutedUserCountSpan.textContent = 'Error'; // Display 'Error' on failure
    exportMutedListCSVButton.disabled = true;
  }

  // Add event listeners
  refreshMutedListButton.addEventListener('click', handleRefreshMutedList);
  exportMutedListCSVButton.addEventListener('click', handleExportMutedList);

  // Add listeners for existing buttons (ensure they are defined in the HTML)
  document.getElementById('openauthorListPage')?.addEventListener('click', handleOpenAuthorListPage);
  document.getElementById('startUndobanAll')?.addEventListener('click', handleStartUndobanAll);
  document.getElementById('openFaq')?.addEventListener('click', handleOpenFaq);
  document.getElementById('migrateBlockedToMuted')?.addEventListener('click', handleMigrateBlockedToMuted);
  document.getElementById('migrateBlockedTitlesToUnblocked')?.addEventListener('click', handleMigrateBlockedTitlesToUnblocked);

  log.info("popup.js: Initialization complete.");
}

// --- Event Handlers ---

function handleRefreshMutedList() { // Changed to non-async
  log.info("popup.js", "Refresh muted list button clicked.");
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_REFRESH_MUTED }); // Assuming new enum value

  updateStatus("Initiating muted list refresh...", false, 0); // Show immediate feedback

  // Send message to background script to handle the refresh process
  chrome.runtime.sendMessage({ action: "refreshMutedList" }, (response) => {
    if (chrome.runtime.lastError) {
      log.error("popup.js: Error sending refreshMutedList message:", chrome.runtime.lastError.message);
      updateStatus("Error initiating refresh: " + chrome.runtime.lastError.message, true, 5000);
      // Re-enable buttons if message sending fails
      refreshMutedListButton.disabled = false;
      const currentCount = parseInt(mutedUserCountSpan.textContent) || 0;
      exportMutedListCSVButton.disabled = currentCount === 0;
    } else {
      log.info("popup.js: refreshMutedList message sent successfully.");
      // Background script will open notification tab and handle progress
      window.close(); // Close popup after initiating
    }
  });
}

async function handleExportMutedList() {
  log.info("popup.js", "Export muted list button clicked.");
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_EXPORT_MUTED }); // Assuming new enum value

  exportMutedListCSVButton.disabled = true; // Disable while processing
  updateStatus("Preparing export...", false, 0);

  try {
    const usernames = await storageHandler.getMutedUserList();
    if (usernames && usernames.length > 0) {
      downloadCSV(usernames);
    } else {
      updateStatus("No muted user list found in storage to export.", true);
    }
  } catch (error) {
    log.err("popup.js", "Error exporting muted list:", error);
    updateStatus(`Error exporting: ${error.message || 'Unknown error'}`, true);
  } finally {
    // Re-enable based on current count
    const currentCount = parseInt(mutedUserCountSpan.textContent) || 0;
    exportMutedListCSVButton.disabled = currentCount === 0;
  }
}

// --- Existing Button Handlers (Refactored) ---

function handleOpenAuthorListPage() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_BAN_LIST });
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/authorListPage.html") }, () => {
    window.close();
  });
}

function handleStartUndobanAll() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_UNDOBANALL });
  chrome.runtime.sendMessage(null, { "banSource": enums.BanSource.UNDOBANALL, "banMode": enums.BanMode.UNDOBAN });
  updateStatus("Starting 'Undo All Bans'...", false, 2000); // Give feedback before potential close
  // Consider not closing popup immediately for feedback?
}

function handleOpenFaq() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_FAQ });
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/faq.html") });
}

function handleMigrateBlockedToMuted() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_MIGRATE });
  updateStatus("Starting migration (Blocked -> Muted)...", false, 0);
  chrome.runtime.sendMessage(null, { action: "startMigration" }, (response) => {
    if (chrome.runtime.lastError) {
      log.error("popup.js: Error sending startMigration message:", chrome.runtime.lastError.message);
      updateStatus("Error starting migration: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      log.info("popup.js: Migration start message sent.");
      window.close(); // Close popup after initiating
    }
  });
}

function handleMigrateBlockedTitlesToUnblocked() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_MIGRATE_TITLES });
  updateStatus("Starting title unblock...", false, 0);
  chrome.runtime.sendMessage(null, { action: "startTitleMigration" }, (response) => {
    if (chrome.runtime.lastError) {
      log.error("popup.js: Error sending startTitleMigration message:", chrome.runtime.lastError.message);
      updateStatus("Error starting title unblock: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      log.info("popup.js: Title migration start message sent.");
      window.close(); // Close popup after initiating
    }
  });
}

// --- Initial Setup ---

// Send initial analytics event
commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_ICON });

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initializePopup);