import * as enums from './enums.js';
import * as utils from './utils.js';

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
  
  // Send a message to the background script that the notification page is ready
  setTimeout(() => {
    chrome.runtime.sendMessage(null, { action: "notificationPageReady" });
    console.log("Notification page ready message sent");
  }, 500); // Small delay to ensure DOM is fully initialized
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message && message.action === "ping") {
    console.log("Received ping from background script");
    sendResponse({ status: "ok" });
    return true; // Keep the message channel open for the async response
  }

  // Handle updateMutedListProgress messages
  if (message && message.action === "updateMutedListProgress") {
    console.log(`Updating muted list progress: Page ${message.currentPage}, Total ${message.currentCount}`);

    // Update the UI elements
    const migrationBar = document.getElementById("migrationBar");
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

      // Update status text if available
      if (migrationStatusText) {
        migrationStatusText.innerHTML = "Sessize alınan kullanıcılar alınıyor...";
      }
    }

    sendResponse({ status: "ok" });
    return true;
  }

  // Handle mutedListRefreshComplete messages
  if (message && message.action === "mutedListRefreshComplete") {
    console.log(`Muted list refresh complete: Success=${message.success}, Count=${message.count}, Error=${message.error}`);

    // Update the UI elements
    const migrationBar = document.getElementById("migrationBar");
    const migrationBarText = document.getElementById("migrationBarText");
    const migrationProgressText = document.getElementById("migrationProgressText");
    const migrationStatusText = document.getElementById("migrationStatusText");
    const migrationResultText = document.getElementById("migrationResultText");

    if (migrationBar && migrationBarText) {
      // Set progress bar to 100% or 0% depending on success
      migrationBar.style.width = message.success ? "100%" : "0%";
      migrationBarText.innerHTML = message.success ? "%100" : "%0";
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
    return true;
  }
  
  // Handle migration progress updates
  if (message && message.action === "updateMigrationProgress") {
    console.log(`Updating migration progress: ${message.current}/${message.total} (${message.percentage}%)`);
    
    // Update the migration progress bar
    const migrationBar = document.getElementById("migrationBar");
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
    const migrationBar = document.getElementById("migrationBar");
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
    const migrationBar = document.getElementById("migrationBar");
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
    const migrationBar = document.getElementById("migrationBar");
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
