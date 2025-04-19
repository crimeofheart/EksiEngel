import * as enums from './enums.js';
import * as utils from './utils.js';
import { commHandler } from './commHandler.js'; // Import commHandler
import { storageHandler } from './storageHandler.js'; // Import storageHandler

// --- Element References ---
let buttonStatusDiv; // Dedicated status div for button actions

document.addEventListener('DOMContentLoaded', async function () {
  // Make the early stop button more visible and add a confirmation
  const earlyStopButton = document.getElementById("earlyStop");
  if (earlyStopButton) {
    // Add some styling to make it more visible
    earlyStopButton.style.backgroundColor = "#ff4444";
    earlyStopButton.style.color = "white";
    earlyStopButton.style.fontWeight = "bold";
    earlyStopButton.style.padding = "8px 16px";

    earlyStopButton.addEventListener("click", function(element) {
      // Send the early stop message
      chrome.runtime.sendMessage(null, {"earlyStop":0});

      // Provide feedback that the button was clicked
      earlyStopButton.textContent = "DURDURULUYOR...";
      earlyStopButton.disabled = true;

      // Update the migration status if we're in a migration
      const migrationStatusDiv = document.getElementById("migrationStatusText");
      if (migrationStatusDiv) {
        migrationStatusDiv.innerHTML = "İşlem durduruluyor...";
      }

      // Also update the cooldown timer if it's active
      const remainingTimeDiv = document.getElementById("remainingTimeInSec");
      if (remainingTimeDiv) {
        remainingTimeDiv.innerHTML = "Durduruluyor...";
      }

      // Update the status text
      const statusTextDiv = document.getElementById("statusText");
      if (statusTextDiv) {
        statusTextDiv.innerHTML = "İşlem kullanıcı tarafından durduruldu.";
      }
    });
  }

  // Get reference for the button status div
  buttonStatusDiv = document.getElementById('buttonStatus');

  // Add event listeners for the new buttons
  document.getElementById('openauthorListPage')?.addEventListener('click', handleOpenAuthorListPage);
  document.getElementById('startUndobanAll')?.addEventListener('click', handleStartUndobanAll);
  document.getElementById('openFaq')?.addEventListener('click', handleOpenFaq);
  document.getElementById('migrateBlockedToMuted')?.addEventListener('click', handleMigrateBlockedToMuted);
  document.getElementById('migrateBlockedTitlesToUnblocked')?.addEventListener('click', handleMigrateBlockedTitlesToUnblocked);
  document.getElementById('refreshMutedList')?.addEventListener('click', handleRefreshMutedList);
  document.getElementById('exportMutedListCSV')?.addEventListener('click', handleExportMutedList);


  // Send a message to the background script that the notification page is ready
  setTimeout(() => {
    chrome.runtime.sendMessage(null, { action: "notificationPageReady" });
    console.log("Notification page ready message sent");
  }, 500); // Small delay to ensure DOM is fully initialized

  // Load and display the initial muted user count from storage
  async function loadMutedUserCount() {
    const mutedUserCount = await storageHandler.getMutedUserCount();
    const mutedUserCountSpan = document.getElementById("mutedUserCount");
    if (mutedUserCountSpan) {
      mutedUserCountSpan.textContent = mutedUserCount;
    }
  }

  loadMutedUserCount();
});

// --- Helper Functions for Buttons ---

/**
 * Updates the dedicated status message area for button actions.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, style as an error.
 * @param {number} clearAfterMs - Milliseconds after which to clear the message (0 = don't clear).
 */
function updateButtonStatus(message, isError = false, clearAfterMs = 3000) {
  if (!buttonStatusDiv) return;
  buttonStatusDiv.textContent = message;
  buttonStatusDiv.style.color = isError ? '#dc3545' : '#333'; // Red for error, dark grey otherwise

  // Clear the message after a delay
  if (clearAfterMs > 0) {
    setTimeout(() => {
      if (buttonStatusDiv.textContent === message) { // Only clear if it hasn't been overwritten
        buttonStatusDiv.textContent = '';
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
    updateButtonStatus("No usernames to export.", true);
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
  updateButtonStatus("Muted user list exported.", false);
}


// --- Event Handlers for Buttons ---

function handleOpenAuthorListPage() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_BAN_LIST });
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/authorListPage.html") });
  updateButtonStatus("Opening Author List Page...", false, 2000);
}

function handleStartUndobanAll() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_UNDOBANALL });
  chrome.runtime.sendMessage(null, { "banSource": enums.BanSource.UNDOBANALL, "banMode": enums.BanMode.UNDOBAN });
  updateButtonStatus("Starting 'Undo All Bans'...", false, 2000);
}

function handleOpenFaq() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_FAQ });
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/faq.html") });
  updateButtonStatus("Opening Settings and Help...", false, 2000);
}

function handleMigrateBlockedToMuted() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_MIGRATE });
  updateButtonStatus("Starting migration (Blocked -> Muted)...", false, 0);
  chrome.runtime.sendMessage(null, { action: "startMigration" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("notification.js: Error sending startMigration message:", chrome.runtime.lastError.message);
      updateButtonStatus("Error starting migration: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      console.log("notification.js: Migration start message sent.");
      // Status updates will come via chrome.runtime.onMessage listener
    }
  });
}

function handleMigrateBlockedTitlesToUnblocked() {
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_MIGRATE_TITLES });
  updateButtonStatus("Starting title unblock...", false, 0);
  chrome.runtime.sendMessage(null, { action: "startTitleMigration" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("notification.js: Error sending startTitleMigration message:", chrome.runtime.lastError.message);
      updateButtonStatus("Error starting title unblock: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      console.log("notification.js: Title migration start message sent.");
      // Status updates will come via chrome.runtime.onMessage listener
    }
  });
}

async function handleRefreshMutedList() {
  console.log("notification.js", "Refresh muted list button clicked.");
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_REFRESH_MUTED });

  updateButtonStatus("Initiating muted list refresh...", false, 0);

  // Send message to background script to handle the refresh process
  chrome.runtime.sendMessage({ action: "refreshMutedList" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("notification.js: Error sending refreshMutedList message:", chrome.runtime.lastError.message);
      updateButtonStatus("Error initiating refresh: " + chrome.runtime.lastError.message, true, 5000);
    } else {
      console.log("notification.js: refreshMutedList message sent successfully.");
      // Background script will handle progress and send updates
    }
  });
}

async function handleExportMutedList() {
  console.log("notification.js", "Export muted list button clicked.");
  commHandler.sendAnalyticsData({ click_type: enums.ClickType.EXTENSION_MENU_EXPORT_MUTED });

  // Disable button while processing (optional, but good UX)
  const exportButton = document.getElementById('exportMutedListCSV');
  if (exportButton) exportButton.disabled = true;

  updateButtonStatus("Preparing export...", false, 0);

  try {
    const usernames = await storageHandler.getMutedUserList();
    if (usernames && usernames.length > 0) {
      downloadCSV(usernames);
    } else {
      updateButtonStatus("No muted user list found in storage to export.", true);
    }
  } catch (error) {
    console.error("notification.js", "Error exporting muted list:", error);
    updateButtonStatus(`Error exporting: ${error.message || 'Unknown error'}`, true);
  } finally {
    // Re-enable button
    const exportButton = document.getElementById('exportMutedListCSV');
    if (exportButton) exportButton.disabled = false; // Re-enable regardless of success/failure
  }
}


// Listen for messages from the background script (Existing logic)
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message && message.action === "ping") {
    console.log("Received ping from background script");
    sendResponse({ status: "ok" });
    return true; // Keep the message channel open for the async response
  }

  // Handle updateMutedListProgress messages (This seems specific to a different process, keeping for now)
  if (message && message.action === "updateMutedListProgress") {
    console.log(`Updating muted list progress: Page ${message.currentPage}, Total ${message.currentCount}`);

    // Update the UI elements
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");

    if (migrationBar && migrationBarText && migrationProgressText) {
      // Calculate percentage (assuming we don't know the total pages)
      // This is a rough estimate, as the number of users per page can vary
      const percentage = message.currentPage * 5; // Assuming ~20 users per page, so 100/20 = 5
      migrationBar.style.width = `${percentage}%`;
      migrationBarText.innerHTML = `%${percentage}`;
      migrationProgressText.innerHTML = `Sayfa: ${message.currentPage}, Toplam: ${message.currentCount}`;

      // Update the muted user count span dynamically
      if (mutedUserCountSpan) {
      const mutedUserCountSpan = document.getElementById("mutedUserCount");
        mutedUserCountSpan.textContent = message.currentCount;
      }

      // Update status text if available
      if (migrationStatusText) {
        migrationStatusText.innerHTML = "Sessize alınan kullanıcılar alınıyor...";
      }
    }

    sendResponse({ status: "ok" });
    return true;
  }

  // Handle mutedListRefreshComplete messages (This seems specific to a different process, keeping for now)
  if (message && message.action === "mutedListRefreshComplete") {
    console.log(`Muted list refresh complete: Success=${message.success}, Count=${message.count}, Error=${message.error}`);

    // Update the UI elements
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const migrationResultText = document.getElementById("migrationResultText");

    if (migrationBar && migrationBarText) {
      // Set progress bar to 100% or 0% depending on success
      migrationBar.style.width = message.success ? "100%" : "0%";
      migrationBarText.innerHTML = message.success ? "%100" : "%0";
    }

      // Update the muted user count span with the final count
      if (mutedUserCountSpan) {
      const mutedUserCountSpan = document.getElementById("mutedUserCount");
        mutedUserCountSpan.textContent = message.count;
      }

    if (migrationStatusText) {
      // Update status text based on success
      migrationStatusText.innerHTML = message.success ? "İşlem tamamlandı!" : "İşlem başarısız!";
    }

    if (migrationProgressText) {
      migrationProgressText.innerHTML = message.success ? `Toplam: ${message.count}` : "";
    }

    if (migrationResultText) {
      // Show result or error message
      migrationResultText.innerHTML = message.success ? `Başarıyla alındı: ${message.count}` : `Hata: ${message.error || "Bilinmeyen hata"}`;
    }

    sendResponse({ status: "ok" });
    return true; // Keep channel open for async response
  }

  // Handle progress messages containing the total count for muted users
  if (message && typeof message === 'string' && message.includes("Total ")) {
    console.log(`Received progress message: ${message}`);
    const totalMatch = message.match(/Total (\d+)/);
    if (totalMatch && totalMatch[1]) {
      const totalCount = totalMatch[1];
      if (mutedUserCountSpan) {
      const mutedUserCountSpan = document.getElementById("mutedUserCount");
        mutedUserCountSpan.textContent = totalCount;
      }
    }
    sendResponse({ status: "ok" });
    return true;
  }

  // --- Handle General Notifications from Background ---
  if (message && message.notification) {
    const notification = message.notification;
    // Only log if it's not a cooldown update to prevent spam
    if (notification.status !== enums.NotificationType.COOLDOWN) {
        console.log("Received general notification:", notification);
    }

    const statusTextDiv = document.getElementById("statusText");
    const errorTextDiv = document.getElementById("errorText"); // Assuming an element with this ID exists or needs to be added
    const progressBar = document.getElementById("progressBar"); // Assuming progress bar elements exist
    const progressBarText = document.getElementById("progressBarText");
    const progressText = document.getElementById("progressText");
    const remainingTimeDiv = document.getElementById("remainingTimeInSec"); // Specific element for cooldown timer

    // Clear previous error messages unless it's a FINISH status with an error
    if (errorTextDiv && notification.status !== enums.NotificationType.FINISH) {
      errorTextDiv.innerHTML = "";
      errorTextDiv.style.display = "none";
    }

    // --- Handle Cooldown ---
    if (notification.status === enums.NotificationType.COOLDOWN) {
      // Check if the cooldown message is the same as the last one
      if (typeof this.lastCooldownMessage === 'undefined' || this.lastCooldownMessage !== notification.statusText + notification.remainingTimeInSec) {
        this.lastCooldownMessage = notification.statusText + notification.remainingTimeInSec;
        if (statusTextDiv) {
          // Display the main cooldown message, including the link
          statusTextDiv.innerHTML = notification.statusText; // This contains the main text + link
        }
        if (remainingTimeDiv) {
          // Update the dedicated timer display
          remainingTimeDiv.innerHTML = `Kalan süre: ${notification.remainingTimeInSec} saniye`;
          remainingTimeDiv.style.display = "inline"; // Make sure it's visible
        }
      }
      // Hide progress bar during cooldown
      if (progressBar) progressBar.style.width = "0%";
      if (progressBarText) progressBarText.innerHTML = "";
      if (progressText) progressText.innerHTML = "";

    } else {
      // --- Handle Non-Cooldown Statuses ---

      // Hide the dedicated cooldown timer if it's not a cooldown status
      if (remainingTimeDiv) {
        remainingTimeDiv.style.display = "none";
      }

      // Update status text
      if (statusTextDiv) {
        statusTextDiv.innerHTML = notification.statusText || "Durum güncellendi."; // Default text if empty
      }

      // Update progress bar for ONGOING status
      if (notification.status === enums.NotificationType.ONGOING && notification.plannedAction > 0) {
        const percentage = Math.round((notification.performedAction / notification.plannedAction) * 100);
        if (progressBar) progressBar.style.width = percentage + "%";
        if (progressBarText) progressBarText.innerHTML = "%" + percentage;
        if (progressText) progressText.innerHTML = "İşlenen: " + notification.performedAction + "/" + notification.plannedAction + " Başarılı: " + notification.successfulAction;
      } else if (notification.status === enums.NotificationType.FINISH) {
         // Set progress bar to 100% on successful finish
        if (progressBar) progressBar.style.width = "100%";
        if (progressBarText) progressBarText.innerHTML = "%100";
        if (progressText) progressText.innerHTML = "Tamamlandı. Başarılı: " + notification.successfulAction + "/" + notification.performedAction;
      } else {
        // Hide progress for other statuses like NOTIFY
        if (progressBar) progressBar.style.width = "0%";
        if (progressBarText) progressBarText.innerHTML = "";
        if (progressText) progressText.innerHTML = "";
      }

      // Handle FINISH status (update completed table, show errors)
      if (notification.status === enums.NotificationType.FINISH && notification.completedProcess) {
        insertCompletedProcessesTable(
          notification.completedProcess.banSource,
          notification.completedProcess.banMode,
          notification.successfulAction,
          notification.performedAction,
          notification.plannedAction,
          notification.errorText || "Başarılı" // Use errorText if provided
        );
        if (notification.errorText && notification.errorText !== "yok" && errorTextDiv) {
           errorTextDiv.innerHTML = `Hata: ${notification.errorText}`;
           errorTextDiv.style.display = "block"; // Show error
        }
         // Re-enable early stop button on finish
        const earlyStopButton = document.getElementById("earlyStop");
        if (earlyStopButton) {
            earlyStopButton.textContent = "ERKEN DURDUR";
            earlyStopButton.disabled = false;
        }
      }

      // Update planned processes table if data is provided
      if (notification.plannedProcesses && notification.plannedProcesses.length >= 0) { // Allow empty array to clear table
        updatePlannedProcessesTable(notification.plannedProcesses);
      }
    }

    sendResponse({status: 'ok'});
    return true; // Keep channel open
  }


  // Handle migration progress updates
  if (message && message.action === "updateMigrationProgress") {
    // Reduced logging frequency for migration progress
    console.debug(`Updating migration progress: ${message.current}/${message.total} (${message.percentage}%)`);

    // Update the migration progress bar
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const statusTextDiv = document.getElementById("statusText");

    if (migrationBar && migrationBarText && migrationProgressText) {
      migrationBar.style.width = `${message.percentage}%`;
      migrationBarText.innerHTML = `%${message.percentage}`;
      migrationProgressText.innerHTML = `İşlenen: ${message.current} / ${message.total}`;

      // Update status text if available
      if (migrationStatusText) {
        migrationStatusText.innerHTML = "İşlem devam ediyor...";
      }

      // Also update the main status text
      if (statusTextDiv) {
        // Check if we're in title unblocking mode or user muting mode
        const isTitleUnblocking = window.location.href.includes("startTitleMigration");
        if (isTitleUnblocking) {
          statusTextDiv.innerHTML = "Durum: Başlık engelleri kaldırılıyor...";
        } else {
          statusTextDiv.innerHTML = "Durum: Engellenen kullanıcılar sessize alınıyor...";
        }
      }
    }

    sendResponse({ status: "ok" });
    return true;
  }

  // Handle migration batch completion
  if (message && message.action === "migrationBatchComplete") {
    console.log(`Migration batch complete: ${message.message}`);

    // Update the migration UI elements
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const migrationResultText = document.getElementById("migrationResultText");

    if (migrationBar && migrationBarText) {
      // Reset progress bar for next batch
      migrationBar.style.width = "0%";
      migrationBarText.innerHTML = "%0";
    }

    if (migrationStatusText) {
      // Update status text to show continuing
      migrationStatusText.innerHTML = "Sonraki grup işleniyor...";
    }

    // Also update the main status text
    const statusTextDiv = document.getElementById("statusText");
    if (statusTextDiv) {
      // Check if we're in title unblocking mode or user muting mode
      const isTitleUnblocking = window.location.href.includes("startTitleMigration");
      if (isTitleUnblocking) {
        statusTextDiv.innerHTML = "Durum: Sonraki başlık grubu işleniyor...";
      } else {
        statusTextDiv.innerHTML = "Durum: Sonraki grup işleniyor...";
      }
    }

    if (migrationResultText) {
      // Show batch results
      migrationResultText.innerHTML = `Grup tamamlandı: Başarılı: ${message.migrated}, Atlanan: ${message.skipped}, Başarısız: ${message.failed}, Toplam: ${message.total}`;
    }

    sendResponse({ status: "ok" });
    return true;
  }

  // Handle migration final completion
  if (message && message.action === "migrationComplete") {
    console.log(`Migration complete: ${message.message}`);

    // Update the migration UI elements
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const migrationResultText = document.getElementById("migrationResultText");

    if (migrationBar && migrationBarText) {
      // Set progress bar to 100%
      migrationBar.style.width = "100%";
      migrationBarText.innerHTML = "%100";
    }

    if (migrationStatusText) {
      // Update status text to completed
      migrationStatusText.innerHTML = "İşlem tamamlandı!";
    }

    // Also update the main status text
    const statusTextDiv = document.getElementById("statusText");
    if (statusTextDiv) {
      // Check if we're in title unblocking mode or user muting mode
      const isTitleUnblocking = window.location.href.includes("startTitleMigration");
      if (isTitleUnblocking) {
        statusTextDiv.innerHTML = "Durum: Başlık engelleri kaldırma işlemi tamamlandı!";
      } else {
        statusTextDiv.innerHTML = "Durum: İşlem tamamlandı!";
      }
    }

    if (migrationResultText) {
      // Show detailed results
      migrationResultText.innerHTML = `Sonuç: Başarılı: ${message.migrated}, Atlanan: ${message.skipped}, Başarısız: ${message.failed}, Toplam: ${message.total}`;
    }

    // Re-enable the early stop button
    const earlyStopButton = document.getElementById("earlyStop");
    if (earlyStopButton) {
      earlyStopButton.textContent = "ERKEN DURDUR";
      earlyStopButton.disabled = false;
    }

    sendResponse({ status: "ok" });
    return true;
  }

  // Handle migration stopped by user
  if (message && message.action === "migrationStopped") {
    console.log(`Migration stopped: ${message.message}`);

    // Update the migration UI elements
    const migrationBar = document.getElementById("migrationBar"); // Assuming these elements exist for this specific progress
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const migrationResultText = document.getElementById("migrationResultText");

    if (migrationStatusText) {
      // Update status text to stopped
      migrationStatusText.innerHTML = "İşlem kullanıcı tarafından durduruldu!";
    }

    // Also update the main status text
    const statusTextDiv = document.getElementById("statusText");
    if (statusTextDiv) {
      // Check if we're in title unblocking mode or user muting mode
      const isTitleUnblocking = window.location.href.includes("startTitleMigration");
      if (isTitleUnblocking) {
        statusTextDiv.innerHTML = "Durum: Başlık engelleri kaldırma işlemi kullanıcı tarafından durduruldu!";
      } else {
        statusTextDiv.innerHTML = "Durum: İşlem kullanıcı tarafından durduruldu!";
      }
    }

    if (migrationResultText) {
      if (message.cooldown) {
        migrationResultText.innerHTML = "İşlem cooldown sırasında durduruldu.";
      } else if (message.processed !== undefined) {
        migrationResultText.innerHTML = `İşlem durduruldu. İşlenen: ${message.processed} / ${message.total}`;
      } else {
        migrationResultText.innerHTML = "İşlem durduruldu.";
      }
    }

    // Re-enable the early stop button
    const earlyStopButton = document.getElementById("earlyStop");
    if (earlyStopButton) {
      earlyStopButton.textContent = "ERKEN DURDUR";
      earlyStopButton.disabled = false;
    }

    // Also update the cooldown text if it exists
    const completionCooldownDiv = document.getElementById("remainingTimeInSec");
    if (completionCooldownDiv) {
      completionCooldownDiv.innerHTML = "Tamamlandı";
    }

    // Also update the cooldown text if it exists
    const stoppedCooldownDiv = document.getElementById("remainingTimeInSec");
    if (stoppedCooldownDiv) {
      stoppedCooldownDiv.innerHTML = "Durduruldu";
    }

    sendResponse({ status: "ok" });
    return true;
  }
});

// insert a row to completed processes table
function insertCompletedProcessesTable(banSource, banMode, successfulAction, performedAction, plannedAction, errorStatus)
{
  let table = document.getElementById("completedProcesses").getElementsByTagName('tbody')[0];
  let row = table.insertRow(0);
  let cell1 = row.insertCell(0);
  let cell2 = row.insertCell(1);
  let cell3 = row.insertCell(2);
  let cell4 = row.insertCell(3);
  let cell5 = row.insertCell(4);
  let cell6 = row.insertCell(5);
  let cell7 = row.insertCell(6);
  let d = new Date();
  cell1.innerHTML = d.getHours() + ":" + d.getMinutes();
  cell2.innerHTML = banSource;
  cell3.innerHTML = banMode;
  cell4.innerHTML = successfulAction;
  cell5.innerHTML = performedAction;
  cell6.innerHTML = plannedAction;
  cell7.innerHTML = errorStatus;
}

// recreate the planned processes table
function updatePlannedProcessesTable(plannedProcesses)
{
  let rowNumber = document.getElementById("plannedProcesses").tBodies[0].rows.length;
  let table = document.getElementById("plannedProcesses").getElementsByTagName('tbody')[0];
  for(let i = 0; i < rowNumber; i++)
    table.deleteRow(0);
  for(let i = 0; i < plannedProcesses.length; i++)
  {
    let row = table.insertRow(0);
    let cell1 = row.insertCell(0);
    let cell2 = row.insertCell(1);
    let cell3 = row.insertCell(2);
    cell1.innerHTML = plannedProcesses[i].creationDateInStr;
    cell2.innerHTML = plannedProcesses[i].banSource;
    cell3.innerHTML = plannedProcesses[i].banMode;
  }
}
