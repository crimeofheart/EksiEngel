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

// listen background script
chrome.runtime.onMessage.addListener(async function messageListener_Background(message, sender, sendResponse) {
  sendResponse({status: 'ok'}); // added to suppress 'message port closed before a response was received' error

	const obj = utils.filterMessage(message, "notification");
	if(obj.resultType === "FAIL")
		return;
  
  console.log("incoming message: " + obj.notification.status);

  if(obj.notification.status === enums.NotificationType.FINISH)
  {
    document.getElementById("statusText").innerHTML = obj.notification.statusText;
    insertCompletedProcessesTable(obj.notification.completedProcess.banSource,
                                  obj.notification.completedProcess.banMode,
                                  obj.notification.successfulAction,
                                  obj.notification.performedAction,
                                  obj.notification.plannedAction,
                                  obj.notification.errorText);
    return;
  }
  if(obj.notification.status === enums.NotificationType.NOTIFY)
  {
    document.getElementById("statusText").innerHTML = obj.notification.statusText;
    return;
  }
  if(obj.notification.status === enums.NotificationType.COOLDOWN)
  {
    // Make it clear this is a cooldown period
    document.getElementById("statusText").innerHTML = obj.notification.statusText;
    document.getElementById("remainingTimeInSec").innerHTML = obj.notification.remainingTimeInSec + " saniye";
    
    // Also update the migration status if we're in a migration
    const migrationStatusDiv = document.getElementById("migrationStatusText");
    if (migrationStatusDiv) {
      // Check if we're in the process of stopping
      const earlyStopButton = document.getElementById("earlyStop");
      if (earlyStopButton && earlyStopButton.disabled) {
        // We're in the process of stopping, don't change the message
        // It should remain as "İşlem durduruluyor..."
      } else {
        // Normal cooldown, show the cooldown message
        migrationStatusDiv.innerHTML = "COOLDOWN: API limiti aşıldı. Bekleniyor...";
      }
    }
    return;
  }
  if(obj.notification.status === enums.NotificationType.UPDATE_PLANNED_PROCESSES)
  {
    updatePlannedProcessesTable(obj.notification.plannedProcesses);
    return;
  }
  if(obj.notification.status === enums.NotificationType.ONGOING)
  {
    document.getElementById("statusText").innerHTML = obj.notification.statusText;
  
    // update values
    document.getElementById("successfulAction").innerHTML = obj.notification.successfulAction;
    document.getElementById("performedAction").innerHTML = obj.notification.performedAction;
    document.getElementById("plannedAction").innerHTML = obj.notification.plannedAction;
    
    // update bar
    let bar = document.getElementById("bar");   
    let barText = document.getElementById("barText");  
    let percentage = (100 * obj.notification.performedAction) / obj.notification.plannedAction;
    if(obj.notification.plannedAction == 0 || obj.notification.plannedAction == "0")
      percentage = 0;
    percentage = parseInt(percentage);
    barText.innerHTML = '%' + percentage;
    bar.style.width = percentage + '%'; 
    return;
  }

  if(obj.notification.status === enums.NotificationType.MIGRATION_UPDATE)
  {
    // Handle migration-specific updates
    const migrationStatusDiv = document.getElementById("migrationStatusText");
    const migrationProgressDiv = document.getElementById("migrationProgressText");
    const migrationResultDiv = document.getElementById("migrationResultText");
    const migrationBar = document.getElementById("migrationBar");
    const migrationBarText = document.getElementById("migrationBarText");

    if (!migrationStatusDiv || !migrationProgressDiv || !migrationResultDiv || !migrationBar || !migrationBarText) {
        console.error("Notification page migration elements not found!");
        return;
    }

    // Always update the main status text
    migrationStatusDiv.innerHTML = obj.notification.statusText || "";
    migrationProgressDiv.innerHTML = ""; // Clear progress text by default
    migrationResultDiv.innerHTML = ""; // Clear result text by default
    migrationBar.style.width = '0%'; // Reset bar
    migrationBarText.innerHTML = '';

    if (obj.notification.migrationStatus === 'progress') {
        if (obj.notification.performedAction !== null && obj.notification.plannedAction !== null && obj.notification.plannedAction > 0) {
            const current = obj.notification.performedAction;
            const total = obj.notification.plannedAction;
            const percentage = parseInt((100 * current) / total);
            migrationProgressDiv.innerHTML = `İşlenen: ${current} / ${total}`;
            migrationBar.style.width = percentage + '%';
            migrationBarText.innerHTML = '%' + percentage;
        } else {
             // If only status text is provided, keep bar at 0 or previous state?
             // For now, reset bar if counts are null
             migrationBar.style.width = '0%';
             migrationBarText.innerHTML = '';
        }
    } else if (obj.notification.migrationStatus === 'finished') {
        migrationResultDiv.innerHTML = `Sonuç: Başarılı: ${obj.notification.successfulAction}, Atlanan: ${obj.notification.skippedCount}, Başarısız: ${obj.notification.failedCount}`;
        migrationBar.style.width = '100%'; // Show completed bar
        migrationBarText.innerHTML = '%100';
    } else if (obj.notification.migrationStatus === 'error') {
        migrationResultDiv.innerHTML = `Hata: ${obj.notification.errorText || 'Bilinmeyen hata'}`;
        migrationBar.style.width = '0%'; // Reset bar on error
        migrationBarText.innerHTML = 'Hata';
    } else if (obj.notification.migrationStatus === 'started') {
        // Initial state, bar at 0
        migrationBar.style.width = '0%';
        migrationBarText.innerHTML = '%0';
    }
    return;
  }
});
