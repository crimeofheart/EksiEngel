import * as enums from './enums.js';
import * as utils from './utils.js'
import {processQueue} from './queue.js';
import {log} from './log.js';
import { notificationHandler } from './notificationHandler.js';
import { relationHandler } from './relationHandler.js';
import { scrapingHandler } from './scrapingHandler.js';
import { config } from './config.js';


class ProgramController

{
  constructor() 
  { 
    this._earlyStop = false;
    this._migrationInProgress = false;

    this._tabId = 0; 
  }
  
  get isActive()
  {
    return processQueue.isRunning;
  }

  set tabId(val)
  {
    this._tabId = val;
  }

  get tabId()
  {
    return this._tabId;
  }
  
  get earlyStop()
  {
    return this._earlyStop;
  }
    
  set earlyStop(val)
  {
    // Always set the flag regardless of program state
    this._earlyStop = val;
    
    if(val)
    {
      if (this._migrationInProgress) {
        log.info("progctrl", "early stop received during migration process.");
      } else if (processQueue.isRunning) {
        log.info("progctrl", "early stop received, number of waiting processes in the queue: " + processQueue.size);
      } else {
        log.info("progctrl", "early stop received, but no process is currently running.");
      }
    }
    else
    {
      log.info("progctrl", "early stop flag cleared.");
    }
  }


  // Private helper method for retrying actions with delay
  async _performActionWithRetry(banMode, id, isTargetUser, isTargetTitle, isTargetMute, retries = 3) {
    let attempt = 0;
    while (attempt < retries) {
      if (this.earlyStop) { // Access class property
        log.info("progctrl", "Migration stopped early during action retry.");
        return { resultType: enums.ResultType.FAIL, earlyStop: true };
      }

      // Use enum keys for logging if available, otherwise use the value
      const banModeStr = Object.keys(enums.BanMode).find(key => enums.BanMode[key] === banMode) || banMode;
      // Reduced logging frequency for action attempts
      if (attempt === 0) {
        log.debug("progctrl", `Attempt ${attempt + 1} for action: ${banModeStr}, id: ${id}, user: ${isTargetUser}, title: ${isTargetTitle}, mute: ${isTargetMute}`);
      }
      
      // relationHandler manages its own counters, reset is important if reusing the instance for multiple steps
      relationHandler.reset();
      const result = await relationHandler.performAction(banMode, id, isTargetUser, isTargetTitle, isTargetMute);

      if (result.resultType === enums.ResultType.SUCCESS) {
        log.debug("progctrl", `Action successful for id: ${id}`);
        return { resultType: enums.ResultType.SUCCESS };
      } else if (result.resultType === enums.ResultType.FAIL && result.retryAfter) {
        // Rate limit hit, use the suggested retryAfter value
        let waitTimeInSec = result.retryAfter > 0 ? result.retryAfter : 65; // Use returned value or default
        log.warn("progctrl", `Action failed for id: ${id} (Rate limited). Retrying after ${waitTimeInSec} seconds...`);

        // Notify user about cooldown via notification page
        for(let i = 1; i <= waitTimeInSec; i++) {
            if(this.earlyStop) break; // Check early stop during wait
            notificationHandler.notifyCooldown(waitTimeInSec - i); // Show countdown
            await utils.sleep(1000); // Wait 1 second
        }

        if(this.earlyStop) { // Re-check after loop in case it was triggered during the last second
             log.info("progctrl", "Operation stopped early during cooldown wait.");

             // Send a final status update (generic stop message)
             try {
               chrome.tabs.sendMessage(this.tabId, {
                 action: "operationStopped", // Use a generic action name
                 message: "Operation stopped by user during cooldown.",
                 cooldown: true
               });
             } catch (e) {
               log.warn("progctrl", `Error sending stop message: ${e}`);
             }

             return { resultType: enums.ResultType.FAIL, earlyStop: true };
        }

        attempt++;
      } else {
         // Handle other failures (not rate limit) - no retry needed for these based on current relationHandler logic
        log.err("progctrl", `Action failed for id: ${id} with result type: ${result.resultType}. Not retrying.`);
        return { resultType: enums.ResultType.FAIL }; // Treat as final failure
      }
    }
    log.err("progctrl", `Action failed for id: ${id} after ${retries} attempts.`);
    return { resultType: enums.ResultType.FAIL }; // Failed after retries
  }

  // Simplified version that only uses alerts and only processes the first page of blocked users
  async migrateBlockedToMuted() {
    log.info("progctrl", "migrateBlockedToMuted function started (simplified version).");

    // Check if already running
    if (this._migrationInProgress) {
       log.warn("progctrl", "Migration from Blocked to Muted is already in progress.");
       // Can't use alert in background script
       chrome.notifications.create({
         type: 'basic',
         iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
         title: 'EksiEngel',
         message: 'Migration is already in progress.'
       });
       return;
    }
    
    // Check if the main processQueue is running something else
    if (processQueue.isRunning) {
       log.warn("progctrl", "Cannot start migration while another operation is running in the queue.");
       // Can't use alert in background script
       chrome.notifications.create({
         type: 'basic',
         iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
         title: 'EksiEngel',
         message: 'Cannot start migration while another operation is running.'
       });
       return;
    }

    log.info("progctrl", "Initial checks passed.");
    this._migrationInProgress = true; // Set flag
    this.earlyStop = false; // Reset early stop flag

    try {
      // Use the simplified method that only fetches the first page
      log.info("progctrl", "Fetching first page of blocked users...");
      const blockedUsersMap = await scrapingHandler.scrapeBlockedUsersFirstPage();
      
      if (!blockedUsersMap || blockedUsersMap.size === 0) {
        log.info("progctrl", "No blocked users found on first page.");
        // Can't use alert in background script
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
          title: 'EksiEngel',
          message: 'No blocked users found on the first page.'
        });
        this._migrationInProgress = false;
        return;
      }
      
      // Convert map to array for processing
      const blockedUsers = Array.from(blockedUsersMap.values());
      log.info("progctrl", `Found ${blockedUsers.length} blocked users on first page.`);
      
      // No confirmation needed, we'll just proceed
      log.info("progctrl", `Proceeding with migration of ${blockedUsers.length} blocked users.`);
      
      // Process users
      let migratedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      
      for (let i = 0; i < blockedUsers.length; i++) {
        const user = blockedUsers[i];
        
        // Check for early stop
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user.",
              processed: i,
              total: blockedUsers.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
          
          break;
        }
        
        // Update progress
        const currentProgress = i + 1;
        const totalUsers = blockedUsers.length;
        const percentage = Math.round((currentProgress / totalUsers) * 100);
        
        // Update progress bar in notification page
        try {
          chrome.tabs.sendMessage(this.tabId, {
            action: "updateMigrationProgress",
            current: currentProgress,
            total: totalUsers,
            percentage: percentage
          });
        } catch (e) {
          // Ignore errors sending to notification page
          log.warn("progctrl", `Error updating progress bar: ${e}`);
        }
        
        // Log progress (every 3 users to avoid too many logs)
        if (i % 3 === 0 || i === blockedUsers.length - 1) {
          log.info("progctrl", `Processing user ${currentProgress}/${totalUsers}: ${user.authorName}`);
        }
        
        // Step A: Unblock
        log.info("progctrl", `Unblocking user: ${user.authorName}`);
        const unblockResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, user.authorId, true, false, false);
        
        // Check if early stop was triggered during the retry
        if (unblockResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during unblock operation.");
          break;
        }
        
        if (unblockResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to unblock user: ${user.authorName}`);
          failedCount++;
          continue;
        }
        
        // For this specific feature, we always want to mute regardless of config setting
        // The whole point of this feature is to migrate from blocked to muted
        log.debug("progctrl", `Proceeding with muting regardless of config.enableMute setting`);
        
        log.info("progctrl", `Muting user: ${user.authorName}`);
        const muteResult = await this._performActionWithRetry(enums.BanMode.BAN, user.authorId, false, false, true);
        
        // Check if early stop was triggered during the retry
        if (muteResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during mute operation.");
          break;
        }
        
        if (muteResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to mute user: ${user.authorName}`);
          failedCount++;
        } else {
          log.info("progctrl", `Successfully migrated user: ${user.authorName}`);
          migratedCount++;
        }
        
        // Small delay between users
        await utils.sleep(500);
      }
      
      const totalProcessed = migratedCount + skippedCount + failedCount;
      
      // Check if we processed a full page (25 users) and should continue
      if (totalProcessed === 25) {
        // We likely have more users to process
        log.info("progctrl", `Processed 25 users. There may be more users to process. Restarting migration...`);
        
        // Update the notification page with batch completion status
        try {
          chrome.tabs.sendMessage(this.tabId, {
            action: "migrationBatchComplete",
            message: `Batch completed. Processed 25 users. Continuing with next batch...`,
            migrated: migratedCount,
            skipped: skippedCount,
            failed: failedCount,
            total: totalProcessed
          });
        } catch (e) {
          log.warn("progctrl", `Error sending batch completion message: ${e}`);
        }
        
        // Wait a bit before starting the next batch
        await utils.sleep(2000);
        
        // Reset counters but keep migration flag
        this._migrationInProgress = false;
        
        // Restart the migration process
        this.migrateBlockedToMuted();
        return;
      }
      
      // This is the final batch (less than 25 users or error occurred)
      const finalMessage = `Migration completed. Successfully migrated: ${migratedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}, Total: ${totalProcessed}`;
      log.info("progctrl", finalMessage);
      
      // Update the notification page with final completion status
      try {
        chrome.tabs.sendMessage(this.tabId, {
          action: "migrationComplete",
          message: finalMessage,
          migrated: migratedCount,
          skipped: skippedCount,
          failed: failedCount,
          total: totalProcessed
        });
      } catch (e) {
        log.warn("progctrl", `Error sending completion message: ${e}`);
      }
      
      // Can't use alert in background script
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
        title: 'EksiEngel - Migration Complete',
        message: finalMessage
      });
      
    } catch (error) {
      log.err("progctrl", `An error occurred during migration: ${error}`, error);
      // Can't use alert in background script
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
        title: 'EksiEngel - Error',
        message: `An error occurred during migration: ${error.message}`
      });
    } finally {
      log.info("progctrl", "Migration function completed.");
      this.earlyStop = false;
      this._migrationInProgress = false;
    }
  }
  
  // Similar to migrateBlockedToMuted but for title-blocked users
  async migrateBlockedTitlesToUnblocked() {
    log.info("progctrl", "migrateBlockedTitlesToUnblocked function started.");

    // Check if already running
    if (this._migrationInProgress) {
       log.warn("progctrl", "Migration from Blocked Titles to Unblocked is already in progress.");
       // Can't use alert in background script
       chrome.notifications.create({
         type: 'basic',
         iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
         title: 'EksiEngel',
         message: 'Migration is already in progress.'
       });
       return;
    }
    
    // Check if the main processQueue is running something else
    if (processQueue.isRunning) {
       log.warn("progctrl", "Cannot start migration while another operation is running in the queue.");
       // Can't use alert in background script
       chrome.notifications.create({
         type: 'basic',
         iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
         title: 'EksiEngel',
         message: 'Cannot start migration while another operation is running.'
       });
       return;
    }

    log.info("progctrl", "Initial checks passed.");
    this._migrationInProgress = true; // Set flag
    this.earlyStop = false; // Reset early stop flag
    
    // Log the migration state for debugging
    log.info("progctrl", `Migration state: _migrationInProgress=${this._migrationInProgress}, earlyStop=${this.earlyStop}`);

    try {
      // Use the simplified method that only fetches the first page
      log.info("progctrl", "Fetching first page of title-blocked users...");
      const blockedTitlesMap = await scrapingHandler.scrapeBlockedTitlesFirstPage();
      
      if (!blockedTitlesMap || blockedTitlesMap.size === 0) {
        log.info("progctrl", "No blocked titles found on first page.");
        // Can't use alert in background script
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
          title: 'EksiEngel',
          message: 'No blocked titles found on the first page.'
        });
        this._migrationInProgress = false;
        return;
      }
      
      // Convert map to array for processing
      const blockedTitles = Array.from(blockedTitlesMap.values());
      log.info("progctrl", `Found ${blockedTitles.length} blocked titles on first page.`);
      
      // No confirmation needed, we'll just proceed
      log.info("progctrl", `Proceeding with migration of ${blockedTitles.length} blocked titles.`);
      
      // Process titles
      let unblockCount = 0;
      let failedCount = 0;
      
      for (let i = 0; i < blockedTitles.length; i++) {
        // Check for early stop at the beginning of each iteration
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user.",
              processed: i,
              total: blockedTitles.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
          
          break;
        }
        
        const title = blockedTitles[i];
        
        // Double-check for early stop after getting the title
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user after getting title.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user.",
              processed: i,
              total: blockedTitles.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
          
          break;
        }
        
        // Update progress
        const currentProgress = i + 1;
        const totalTitles = blockedTitles.length;
        const percentage = Math.round((currentProgress / totalTitles) * 100);
        
        // Update progress bar in notification page
        try {
          chrome.tabs.sendMessage(this.tabId, {
            action: "updateMigrationProgress",
            current: currentProgress,
            total: totalTitles,
            percentage: percentage
          });
        } catch (e) {
          // Ignore errors sending to notification page
          log.warn("progctrl", `Error updating progress bar: ${e}`);
        }
        
        // Log progress (every 3 titles to avoid too many logs)
        if (i % 3 === 0 || i === blockedTitles.length - 1) {
          log.info("progctrl", `Processing title ${currentProgress}/${totalTitles}: ${title.titleName}`);
        }
        
        // First, check if the user is muted
        log.info("progctrl", `Checking if user is muted: ${title.authorName}`);
        const isMuted = await this._checkIfUserIsMuted(title.authorId);
        
        // Check for early stop before unblocking
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user before unblocking.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user.",
              processed: i,
              total: blockedTitles.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
          
          break;
        }
        
        // Unblock the title
        if (!title.titleId) {
          log.warn("progctrl", `Missing title ID for title: ${title.titleName}, skipping`);
          continue;
        }
        
        log.info("progctrl", `Unblocking title: ${title.titleName} (ID: ${title.titleId})`);
        const unblockResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, title.titleId, false, true, false);
        
        // Check if early stop was triggered during the retry
        if (unblockResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during unblock operation.");
          break;
        }
        
        if (unblockResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to unblock title: ${title.titleName}`);
          failedCount++;
        } else {
          log.info("progctrl", `Successfully unblocked title: ${title.titleName}`);
          
          // If the user was muted, ensure they stay muted
          if (isMuted && title.authorId) {
            log.info("progctrl", `Ensuring user remains muted: ${title.authorName}`);
            const muteResult = await this._performActionWithRetry(enums.BanMode.BAN, title.authorId, false, false, true);
            
            // Check if early stop was triggered during the retry
            if (muteResult.earlyStop) {
              log.info("progctrl", "Migration stopped early by user during mute operation.");
              break;
            }
            
            if (muteResult.resultType !== enums.ResultType.SUCCESS) {
              log.warn("progctrl", `Failed to ensure user remains muted: ${title.authorName}`);
            } else {
              log.info("progctrl", `Successfully ensured user remains muted: ${title.authorName}`);
            }
          }
          
          unblockCount++;
        }
        
        // Small delay between titles
        await utils.sleep(500);
      }
      
      const totalProcessed = unblockCount + failedCount;
      
      // Check if early stop was requested
      if (this.earlyStop) {
        log.info("progctrl", "Migration stopped early by user before checking for more pages.");
        
        // Send a final status update to the notification page
        try {
          chrome.tabs.sendMessage(this.tabId, {
            action: "migrationStopped",
            message: "Migration stopped by user before checking for more pages.",
            processed: totalProcessed,
            total: blockedTitles.length
          });
        } catch (e) {
          log.warn("progctrl", `Error sending stop message: ${e}`);
        }
      }
      // Check if we processed a full page (25 titles) and should continue
      else if (totalProcessed === 25 && !this.earlyStop) {
        // We likely have more titles to process
        log.info("progctrl", `Processed 25 titles. There may be more titles to process. Restarting migration...`);
        
        // Update the notification page with batch completion status
        try {
          chrome.tabs.sendMessage(this.tabId, {
            action: "migrationBatchComplete",
            message: `Batch completed. Processed 25 titles. Continuing with next batch...`,
            unblocked: unblockCount,
            failed: failedCount,
            total: totalProcessed
          });
        } catch (e) {
          log.warn("progctrl", `Error sending batch completion message: ${e}`);
        }
        
        // Wait a bit before starting the next batch
        await utils.sleep(2000);
        
        // Store the current early stop state
        const wasEarlyStopped = this.earlyStop;
        
        // Reset counters but keep migration flag
        this._migrationInProgress = false;
        
        // Only restart if early stop wasn't requested
        if (!wasEarlyStopped) {
          // Restart the migration process
          this.migrateBlockedTitlesToUnblocked();
        } else {
          log.info("progctrl", "Not restarting migration because early stop was requested.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user before starting next batch.",
              processed: totalProcessed,
              total: blockedTitles.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
        }
        return;
      } else if (!this.earlyStop) {
        // Check if there are more pages to process
        log.info("progctrl", `Processed ${totalProcessed} titles. Checking if there are more pages...`);
        
        // Fetch the next page to see if there are more titles
        const nextPageTitles = await scrapingHandler.scrapeBlockedTitlesFirstPage(2); // Get page 2
        
        // Check for early stop after fetching next page
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user after checking for more pages.");
          
          // Send a final status update to the notification page
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationStopped",
              message: "Migration stopped by user after checking for more pages.",
              processed: totalProcessed,
              total: blockedTitles.length
            });
          } catch (e) {
            log.warn("progctrl", `Error sending stop message: ${e}`);
          }
        }
        else if (nextPageTitles && nextPageTitles.size > 0) {
          // There are more titles to process
          log.info("progctrl", `Found ${nextPageTitles.size} more titles on the next page. Continuing migration...`);
          
          // Update the notification page with batch completion status
          try {
            chrome.tabs.sendMessage(this.tabId, {
              action: "migrationBatchComplete",
              message: `Batch completed. Found ${nextPageTitles.size} more titles. Continuing with next batch...`,
              unblocked: unblockCount,
              failed: failedCount,
              total: totalProcessed
            });
          } catch (e) {
            log.warn("progctrl", `Error sending batch completion message: ${e}`);
          }
          
          // Wait a bit before starting the next batch
          await utils.sleep(2000);
          
          // Store the current early stop state
          const wasEarlyStopped = this.earlyStop;
          
          // Reset counters but keep migration flag
          this._migrationInProgress = false;
          
          // Only restart if early stop wasn't requested
          if (!wasEarlyStopped) {
            // Restart the migration process
            this.migrateBlockedTitlesToUnblocked();
          } else {
            log.info("progctrl", "Not restarting migration because early stop was requested.");
            
            // Send a final status update to the notification page
            try {
              chrome.tabs.sendMessage(this.tabId, {
                action: "migrationStopped",
                message: "Migration stopped by user before starting next batch.",
                processed: totalProcessed,
                total: blockedTitles.length
              });
            } catch (e) {
              log.warn("progctrl", `Error sending stop message: ${e}`);
            }
          }
          return;
        }
      }
      
      // This is the final batch (less than 25 titles or error occurred)
      const finalMessage = `Migration completed. Successfully unblocked: ${unblockCount}, Failed: ${failedCount}, Total: ${totalProcessed}`;
      log.info("progctrl", finalMessage);
      
      // Update the notification page with final completion status
      try {
        chrome.tabs.sendMessage(this.tabId, {
          action: "migrationComplete",
          message: finalMessage,
          unblocked: unblockCount,
          failed: failedCount,
          total: totalProcessed
        });
      } catch (e) {
        log.warn("progctrl", `Error sending completion message: ${e}`);
      }
      
      // Can't use alert in background script
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
        title: 'EksiEngel - Migration Complete',
        message: finalMessage
      });
      
    } catch (error) {
      log.err("progctrl", `An error occurred during migration: ${error}`, error);
      // Can't use alert in background script
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
        title: 'EksiEngel - Error',
        message: `An error occurred during migration: ${error.message}`
      });
    } finally {
      log.info("progctrl", "Migration function completed.");
      this.earlyStop = false;
      this._migrationInProgress = false;
    }
  }
  
  // Helper method to check if a user is muted
  async _checkIfUserIsMuted(authorId) {
    // Check if authorId is valid
    if (!authorId) {
      log.warn("progctrl", "Cannot check mute status: Invalid author ID");
      return false;
    }
    
    try {
      // Fetch the user's relationship status
      const userRelationship = await scrapingHandler.scrapeAuthorRelationship(authorId);
      
      // Check if the user is muted
      if (userRelationship && userRelationship.isBannedMute) {
        log.info("progctrl", `User with ID ${authorId} is muted.`);
        return true;
      } else {
        log.info("progctrl", `User with ID ${authorId} is not muted.`);
        return false;
      }
    } catch (error) {
      log.err("progctrl", `Error checking if user is muted: ${error}`);
      // Default to false if there's an error
      return false;
    }
  }
}

export let programController = new ProgramController();

// listen notification to detect early stop
chrome.runtime.onMessage.addListener(async function messageListener_Notifications(message, sender, sendResponse) {
  sendResponse({status: 'ok'}); // added to suppress 'message port closed before a response was received' error
	
	const obj = utils.filterMessage(message, "earlyStop");
	if(obj.resultType === enums.ResultType.FAIL)
	   return;
	 
	 // Check if either the standard queue is running or our migration is in progress
	 if(!programController.isActive && !programController._migrationInProgress)
	 {
	   log.info("progctrl", "early stop received, yet program is not running, so it will be ignored.");
	   return;
	 }
		
	 log.info("progctrl", "Early stop received and will be processed.");
	 programController.earlyStop = true;
});

// this listener fired every time a tab is closed by the user
chrome.tabs.onRemoved.addListener(function(tabid, removed) {
  if(tabid == programController.tabId)
  {
    log.info("progctrl", "user has closed the notification tab, earlyStop will be generated automatically.");
    programController.earlyStop = true;
  }
});
