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
let blockedUserCountSpan; // Added
let refreshBlockedListButton; // Added
let exportBlockedListCSVButton; // Added
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

  // Set initial count to 0
  if (mutedUserCountSpan) {
    mutedUserCountSpan.textContent = '0';
  }

  // Set initial count from storage
  try {
    const count = await storageHandler.getMutedUserCount();
    if (mutedUserCountSpan) {
      mutedUserCountSpan.textContent = count;
    }
    if (exportMutedListCSVButton) {
      exportMutedListCSVButton.disabled = count === 0;
    }
  } catch (error) {
    log.err("popup.js", "Error getting initial muted count:", error);
    if (mutedUserCountSpan) {
      mutedUserCountSpan.textContent = 'Error'; // Display 'Error' on failure
    }
    if (exportMutedListCSVButton) {
      exportMutedListCSVButton.disabled = true;
    }
  }

  // Get element references for blocked users
  blockedUserCountSpan = document.getElementById('blockedUserCount'); // Added
  refreshBlockedListButton = document.getElementById('refreshBlockedList'); // Added
  exportBlockedListCSVButton = document.getElementById('exportBlockedListCSV'); // Added

  // Set initial blocked count to 0
  if (blockedUserCountSpan) { // Added
    blockedUserCountSpan.textContent = '0'; // Added
  } // Added

  // Set initial blocked count from storage
  try { // Added
    const count = await storageHandler.getBlockedUserCount(); // Added
    if (blockedUserCountSpan) { // Added
      blockedUserCountSpan.textContent = count; // Added
    } // Added
    if (exportBlockedListCSVButton) { // Added
      exportBlockedListCSVButton.disabled = count === 0; // Added
    } // Added
  } catch (error) { // Added
    log.err("popup.js", "Error getting initial blocked count:", error); // Added
    if (blockedUserCountSpan) { // Added
      blockedUserCountSpan.textContent = 'Error'; // Added
    } // Added
    if (exportBlockedListCSVButton) { // Added
      exportBlockedListCSVButton.disabled = true; // Added
    } // Added
  } // Added

  // Add event listeners for muted users
  refreshMutedListButton.addEventListener('click', handleRefreshMutedList);
  exportMutedListCSVButton.addEventListener('click', handleExportMutedList);

  // Add event listeners for blocked users // Added
  if (refreshBlockedListButton) { // Added
    refreshBlockedListButton.addEventListener('click', handleRefreshBlockedList); // Added
  } // Added
  if (exportBlockedListCSVButton) { // Added
    exportBlockedListCSVButton.addEventListener('click', handleExportBlockedList); // Added
  } // Added

  // Add listeners for existing buttons (ensure they are defined in the HTML)
  document.getElementById('openauthorListPage')?.addEventListener('click', handleOpenAuthorListPage);
  document.getElementById('startUndobanAll')?.addEventListener('click', handleStartUndobanAll);
  document.getElementById('openFaq')?.addEventListener('click', handleOpenFaq);
  document.getElementById('migrateBlockedToMuted')?.addEventListener('click', handleMigrateBlockedToMuted);
  document.getElementById('migrateBlockedTitlesToUnblocked')?.addEventListener('click', handleMigrateBlockedTitlesToUnblocked);
  document.getElementById('btnBlockMutedUsers')?.addEventListener('click', handleBlockMutedUsers);
  document.getElementById('btnBlockTitlesOfBlockedMuted')?.addEventListener('click', handleBlockTitlesOfBlockedMuted);

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
      log.info("popup.js: refreshMutedList message sent successfully. Waiting for completion message.");
      // Background script will open notification tab and handle progress
      // Do NOT close the window immediately, wait for completion message
    }
  });
}

// Add a listener for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "mutedListRefreshComplete") {
    log.info("popup.js: Received mutedListRefreshComplete message.", request);
    refreshMutedListButton.disabled = false; // Re-enable the button

    if (request.success) {
      updateStatus(`Muted list refreshed. Found ${request.count} users.`, false, 5000);
      // Update the displayed count
      if (mutedUserCountSpan) {
        mutedUserCountSpan.textContent = request.count;
      }
      // Re-enable export button if count > 0
      exportMutedListCSVButton.disabled = request.count === 0;
    } else {
      const errorMessage = request.stoppedEarly ? "Muted list refresh stopped by user." : `Muted list refresh failed: ${request.error}`;
      updateStatus(errorMessage, true, 5000);
      // Re-enable export button based on current count in case of error
      const currentCount = parseInt(mutedUserCountSpan.textContent) || 0;
      exportMutedListCSVButton.disabled = currentCount === 0;
    }
    sendResponse({ status: "ok" }); // Acknowledge the message
  }
});

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

// --- New Blocked User Handlers --- // Added

function handleRefreshBlockedList() { // Added
  log.info("popup.js", "Refresh blocked list button clicked."); // Added
  // TODO: Add Analytics Data Point for blocked list refresh // Added

  updateStatus("Initiating blocked list refresh...", false, 0); // Added

  // Send message to background script to handle the refresh process // Added
  chrome.runtime.sendMessage({ action: "refreshBlockedList" }, (response) => { // Added
    if (chrome.runtime.lastError) { // Added
      log.error("popup.js: Error sending refreshBlockedList message:", chrome.runtime.lastError.message); // Added
      updateStatus("Error initiating refresh: " + chrome.runtime.lastError.message, true, 5000); // Added
      // Re-enable buttons if message sending fails // Added
      if (refreshBlockedListButton) refreshBlockedListButton.disabled = false; // Added
      const currentCount = parseInt(blockedUserCountSpan.textContent) || 0; // Added
      if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = currentCount === 0; // Added
    } else { // Added
      log.info("popup.js: refreshBlockedList message sent successfully. Waiting for completion message."); // Added
      // Background script will open notification tab and handle progress // Added
      // Do NOT close the window immediately, wait for completion message // Added
    } // Added
  }); // Added
} // Added

async function handleExportBlockedList() { // Added
  log.info("popup.js", "Export blocked list button clicked."); // Added
  // TODO: Add Analytics Data Point for blocked list export // Added

  if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = true; // Disable while processing // Added
  updateStatus("Preparing export...", false, 0); // Added

  try { // Added
    const usernames = await storageHandler.getBlockedUserList(); // Added
    if (usernames && usernames.length > 0) { // Added
      downloadCSV(usernames); // Reuse the existing downloadCSV function // Added
    } else { // Added
      updateStatus("No blocked user list found in storage to export.", true); // Added
    } // Added
  } catch (error) { // Added
    log.err("popup.js", "Error exporting blocked list:", error); // Added
    updateStatus(`Error exporting: ${error.message || 'Unknown error'}`, true); // Added
  } finally { // Added
    // Re-enable based on current count // Added
    const currentCount = parseInt(blockedUserCountSpan.textContent) || 0; // Added
    if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = currentCount === 0; // Added
  } // Added
} // Added

// Add a listener for messages from the background script (including new blocked list messages) // Added
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => { // Added
  // Handle muted list refresh complete (existing logic) // Added
  if (request.action === "mutedListRefreshComplete") { // Added
    log.info("popup.js: Received mutedListRefreshComplete message.", request); // Added
    if (refreshMutedListButton) refreshMutedListButton.disabled = false; // Re-enable the button // Added

    if (request.success) { // Added
      updateStatus(`Muted list refreshed. Found ${request.count} users.`, false, 5000); // Added
      // Update the displayed count // Added
      if (mutedUserCountSpan) { // Added
        mutedUserCountSpan.textContent = request.count; // Added
      } // Added
      // Re-enable export button if count > 0 // Added
      if (exportMutedListCSVButton) exportMutedListCSVButton.disabled = request.count === 0; // Added
    } else { // Added
      const errorMessage = request.stoppedEarly ? "Muted list refresh stopped by user." : `Muted list refresh failed: ${request.error}`; // Added
      updateStatus(errorMessage, true, 5000); // Added
      // Re-enable export button based on current count in case of error // Added
      const currentCount = parseInt(mutedUserCountSpan.textContent) || 0; // Added
      if (exportMutedListCSVButton) exportMutedListCSVButton.disabled = currentCount === 0; // Added
    } // Added
    sendResponse({ status: "ok" }); // Acknowledge the message // Added
    return true; // Keep the message channel open for the async response // Added
  } // Added

  // Handle blocked list refresh complete (new logic) // Added
  if (request.action === "blockedListRefreshComplete") { // Added
    log.info("popup.js: Received blockedListRefreshComplete message.", request); // Added
    if (refreshBlockedListButton) refreshBlockedListButton.disabled = false; // Re-enable the button // Added

    if (request.success) { // Added
      updateStatus(`Blocked list refreshed. Found ${request.count} users.`, false, 5000); // Added
      // Update the displayed count // Added
      if (blockedUserCountSpan) { // Added
        blockedUserCountSpan.textContent = request.count; // Added
      } // Added
      // Re-enable export button if count > 0 // Added
      if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = request.count === 0; // Added
    } else { // Added
      const errorMessage = request.stoppedEarly ? "Blocked list refresh stopped by user." : `Blocked list refresh failed: ${request.error}`; // Added
      updateStatus(errorMessage, true, 5000); // Added
      // Re-enable export button based on current count in case of error // Added
      const currentCount = parseInt(blockedUserCountSpan.textContent) || 0; // Added
      if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = currentCount === 0; // Added
    } // Added
    sendResponse({ status: "ok" }); // Acknowledge the message // Added
    return true; // Keep the message channel open for the async response // Added
  } // Added

  // Handle blocked list refresh progress (new logic) // Added
  if (request.action === "blockedListRefreshProgress") { // Added
    log.info("popup.js: Received blockedListRefreshProgress message.", request); // Added
    // Update the displayed count // Added
    if (blockedUserCountSpan) { // Added
      blockedUserCountSpan.textContent = request.count; // Added
    } // Added
    // Keep export button disabled during refresh // Added
    if (exportBlockedListCSVButton) exportBlockedListCSVButton.disabled = true; // Added
    sendResponse({ status: "ok" }); // Acknowledge the message // Added
    return true; // Keep the message channel open for the async response // Added
  } // Added

  // If the message is not handled by the above, let other listeners handle it // Added
  return false; // Indicate that the message was not fully handled here // Added
}); // Added

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

function handleBlockMutedUsers() {
  // TODO: Add Analytics Data Point
  updateStatus("Starting 'Block Muted Users' process...", false, 0);
  chrome.runtime.sendMessage({ action: "blockMutedUsers" }, (response) => {
    if (chrome.runtime.lastError) {
      log.error("popup.js: Error sending blockMutedUsers message:", chrome.runtime.lastError.message);
      updateStatus("Error starting process: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      log.info("popup.js: blockMutedUsers message sent.");
      window.close(); // Close popup after initiating
    }
  });
}

function handleBlockTitlesOfBlockedMuted() {
  // TODO: Add Analytics Data Point
  updateStatus("Starting 'Block Titles of Blocked/Muted' process...", false, 0);
  chrome.runtime.sendMessage({ action: "blockTitlesOfBlockedMuted" }, (response) => {
    if (chrome.runtime.lastError) {
      log.error("popup.js: Error sending blockTitlesOfBlockedMuted message:", chrome.runtime.lastError.message);
      updateStatus("Error starting process: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      log.info("popup.js: blockTitlesOfBlockedMuted message sent.");
      window.close(); // Close popup after initiating
    }
  });
}


// --- Initial Setup ---

// Send initial analytics event
commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_ICON });

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initializePopup);