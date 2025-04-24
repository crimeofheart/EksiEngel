import * as enums from './enums.js';
import * as utils from './utils.js'
import {processQueue} from './queue.js';
import {log} from './log.js';
import { notificationHandler } from './notificationHandler.js';
import { relationHandler } from './relationHandler.js';
import { scrapingHandler } from './scrapingHandler.js';
import { config } from './config.js';
import { storageHandler } from './storageHandler.js';


class ProgramController

{
  constructor()
  {
    this._earlyStop = false;
    this._migrationInProgress = false;
    this._isMutedListRefreshInProgress = false; // New flag for muted list refresh
    this._blockMutedUsersInProgress = false; // Flag for blocking muted users
    this._blockTitlesInProgress = false; // Flag for blocking titles of blocked/muted

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
      } else if (this._isMutedListRefreshInProgress) { // Check for muted list refresh
        log.info("progctrl", "early stop received during muted list refresh process.");
      } else if (this._blockMutedUsersInProgress) { // Check for block muted users
        log.info("progctrl", "early stop received during block muted users process.");
      } else if (this._blockTitlesInProgress) { // Check for block titles
        log.info("progctrl", "early stop received during block titles process.");
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

  get isMutedListRefreshInProgress() {
    return this._isMutedListRefreshInProgress;
  }

  set isMutedListRefreshInProgress(val) {
    this._isMutedListRefreshInProgress = val;
    if (val) {
      log.info("progctrl", "Muted list refresh process started.");
    } else {
      log.info("progctrl", "Muted list refresh process finished.");
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
    log.info("progctrl", "migrateBlockedToMuted function started.");

    // Check if already running
    if (this._migrationInProgress) {
       log.warn("progctrl", "Migration from Blocked to Muted is already in progress.");
       try {
         chrome.tabs.sendMessage(this.tabId, {
           action: "updateMigrationStatus",
           statusText: "Migration already in progress."
         });
       } catch (e) {
         log.warn("progctrl", `Error sending status update: ${e}`);
       }
       return;
    }

    // Check if the main processQueue is running something else
    if (processQueue.isRunning) {
       log.warn("progctrl", "Cannot start migration while another operation is running in the queue.");
       try {
         chrome.tabs.sendMessage(this.tabId, {
           action: "updateMigrationStatus",
           statusText: "Cannot start migration while another operation is running."
         });
       } catch (e) {
         log.warn("progctrl", `Error sending status update: ${e}`);
       }
       return;
    }

    log.info("progctrl", "Initial checks passed.");
    this._migrationInProgress = true; // Set flag
    this.earlyStop = false; // Reset early stop flag

    try {
      // Fetch all blocked users
      log.info("progctrl", "Fetching all blocked users...");
      // Send status update: Fetching users
      notificationHandler.notify("Engellenen kullanıcılar getiriliyor...");
      const scrapeResult = await scrapingHandler.scrapeAllBlockedUsers();

      if (!scrapeResult.success) {
        log.err("progctrl", `Failed to fetch blocked users: ${scrapeResult.error}`);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
          title: 'EksiEngel - Error',
          message: `Failed to fetch blocked users: ${scrapeResult.error}`
        });
        this._migrationInProgress = false;
        notificationHandler.notify(`Engellenen kullanıcılar getirilemedi: ${scrapeResult.error}`);
        return;
      }

      const blockedUsers = scrapeResult.usernames.map(username => ({ authorName: username, authorId: null })); // Create objects with placeholder ID
      const totalBlockedUsers = scrapeResult.count;

      if (blockedUsers.length === 0) {
        log.info("progctrl", "No blocked users found.");
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/img/eksiengel48.png'),
          title: 'EksiEngel',
          message: 'No blocked users found.'
        });
        this._migrationInProgress = false;
        notificationHandler.notify("Engellenen kullanıcı bulunamadı.");
        return;
      }

      log.info("progctrl", `Found ${blockedUsers.length} blocked users.`);

      // No confirmation needed, we'll just proceed
      log.info("progctrl", `Proceeding with migration of ${blockedUsers.length} blocked users.`);
      // Send status update: Starting migration
      notificationHandler.notify(`Engellenen ${blockedUsers.length} kullanıcı sessize alınıyor...`);


      // Process users
      let migratedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < blockedUsers.length; i++) {
        const user = blockedUsers[i];

        // Check for early stop
        if (this.earlyStop) {
          log.info("progctrl", "Migration stopped early by user.");
          notificationHandler.notify(`Taşıma işlemi kullanıcı tarafından durduruldu. İşlenen: ${i}/${blockedUsers.length}`);
          break;
        }

        // Update progress
        const currentProgress = i + 1;
        const totalUsers = blockedUsers.length;
        const percentage = Math.round((currentProgress / totalUsers) * 100);

        // Update progress bar in notification page using notifyOngoing
        // Use migratedCount for successful actions, currentProgress for processed, totalUsers for total
        notificationHandler.notifyOngoing(migratedCount, currentProgress, totalUsers);

        // Step A: Get the user ID by scraping their profile page
        log.info("progctrl", `Scraping user ID for: ${user.authorName}...`);
        const authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(user.authorName);

        if (!authorId || authorId === "0") {
          log.err("progctrl", `Could not scrape user ID for ${user.authorName}. Skipping.`);
          failedCount++;
          // No specific notification here, failure is counted and loop continues
          continue; // Skip to the next user
        }

        log.info("progctrl", `Successfully scraped user ID for ${user.authorName}: ${authorId}`);

        // Step B: Unblock
        log.info("progctrl", `Unblocking user: ${user.authorName} (ID: ${authorId})...`);
        const unblockResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, authorId, true, false, false);

        // Check if early stop was triggered during the retry
        if (unblockResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during unblock operation.");
          break;
        }

        if (unblockResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to unblock user: ${user.authorName} (ID: ${authorId})`);
          failedCount++;
          // No specific notification here, failure is counted and loop continues
          continue; // Skip to the next user if unblock fails
        }

        // For this specific feature, we always want to mute regardless of config setting
        // The whole point of this feature is to migrate from blocked to muted
        log.debug("progctrl", `Proceeding with muting regardless of config.enableMute setting`);

        log.info("progctrl", `Muting user: ${user.authorName} (ID: ${authorId})...`);
        const muteResult = await this._performActionWithRetry(enums.BanMode.BAN, authorId, false, false, true);

        // Check if early stop was triggered during the retry
        if (muteResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during mute operation.");
          break;
        }

        if (muteResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to mute user: ${user.authorName} (ID: ${authorId})`);
          failedCount++;
          // No specific notification here, failure is counted
        } else {
          log.info("progctrl", `Successfully migrated user: ${user.authorName} (ID: ${authorId})`);
          migratedCount++;
          // Success is counted, notifyOngoing will reflect this in the next iteration
        }

        // Small delay between users
        await utils.sleep(500);
      }

      // Note: The migrateBlockedToMuted function does not remove users from a local muted list
      // because it's migrating *from* blocked *to* muted. The muted list is the destination.
      // The logic for usersToRemoveFromMuted and updating muted storage was incorrectly
      // copied from blockMutedUsers. Removing it here.

      // Final status update using finishSuccess or finishErrorEarlyStop
      const totalProcessed = migratedCount + failedCount + skippedCount; // Calculate total processed
      if (this.earlyStop) {
          log.info("progctrl", `Migration stopped early. Migrated: ${migratedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}, Total Processed: ${totalProcessed}`);
          notificationHandler.finishErrorEarlyStop(enums.BanSource.MIGRATE_BLOCKED_TO_MUTED, enums.BanMode.BAN, migratedCount, totalProcessed, blockedUsers.length); // Assuming BAN mode for the final mute action
      } else {
          const finalMessage = `Taşıma tamamlandı. Başarıyla taşınan: ${migratedCount}, Başarısız: ${failedCount}, Atlanan: ${skippedCount}, Toplam işlenen: ${totalProcessed}`;
          log.info("progctrl", finalMessage);
          notificationHandler.finishSuccess(enums.BanSource.MIGRATE_BLOCKED_TO_MUTED, enums.BanMode.BAN, migratedCount, totalProcessed, blockedUsers.length); // Assuming BAN mode for the final mute action
      }


    } catch (error) {
      log.err("progctrl", `An error occurred during migration: ${error}`, error);
      // Use notify for general error status before finally block
      notificationHandler.notify(`Taşıma sırasında bir hata oluştu: ${error.message || "Bilinmeyen hata"}`);
      // Consider adding a finishError call here if appropriate, depending on desired final state display
    } finally {
      log.info("progctrl", "migrateBlockedToMuted function completed.");
      this.earlyStop = false; // Reset early stop flag in finally
      this._migrationInProgress = false; // Reset migration flag in finally
      // Refresh relevant counts if needed
      notificationHandler.notifyUpdateCounts();
    }
  }

  async blockMutedUsers() {
    log.info("progctrl", "blockMutedUsers function started.");

    if (this._blockMutedUsersInProgress) {
      log.warn("progctrl", "Blocking muted users is already in progress.");
      notificationHandler.notify("Sessize alınmış kullanıcıları engelleme zaten devam ediyor.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start blocking muted users while another operation is running.");
      notificationHandler.notify("Başka bir işlem çalışırken sessize alınmış kullanıcıları engelleme başlatılamaz.");
      return;
    }

    this._blockMutedUsersInProgress = true;
    this.earlyStop = false;

    let blockedCount = 0;
    let unmutedCount = 0;
    let failedCount = 0;
    let processedCount = 0;
    const successfullyProcessedUsernames = []; // To track users to remove from storage
    let totalUsersFound = 0; // Keep track of total users found across all pages

    try {
      notificationHandler.notify("Sessize alınan kullanıcılar sayfa sayfa getiriliyor ve işleniyor...");

      let isLastPage = false;
      let pageIndex = 0;
      const politeDelayMs = 500; // Delay between page requests

      while (!isLastPage && !this.earlyStop) {
        pageIndex++;
        log.info("progctrl", `Fetching muted users page ${pageIndex}...`);
        notificationHandler.notify(`Sessize alınan kullanıcılar getiriliyor: Sayfa ${pageIndex}...`);

        let partialListObj;
        try {
          // Fetch a page of muted users using the new public method
          partialListObj = await scrapingHandler.scrapeMutedUsersPage(pageIndex);

          // Check for early stop after fetching a page
          if (this.earlyStop) {
            log.info("progctrl", "Blocking muted users stopped early by user during page fetch.");
            notificationHandler.notify(`Sessize alınan kullanıcıları engelleme işlemi kullanıcı tarafından durduruldu. İşlenen: ${processedCount} kullanıcı.`);
            break; // Exit the while loop
          }

          // Basic check if the response structure is as expected
          if (!partialListObj || typeof partialListObj.isLast !== 'boolean' || !Array.isArray(partialListObj.authorNameList)) {
             throw new Error(`Unexpected result fetching page ${pageIndex}.`);
          }

          isLastPage = partialListObj.isLast;
          const pageUsernames = partialListObj.authorNameList;
          const pageUserIds = partialListObj.authorIdList; // Assuming IDs are also returned

          if (pageUsernames.length > 0) {
            totalUsersFound += pageUsernames.length;
            log.info("progctrl", `Found ${pageUsernames.length} users on page ${pageIndex}. Total found so far: ${totalUsersFound}`);
            notificationHandler.notify(`Sayfa ${pageIndex}'de ${pageUsernames.length} kullanıcı bulundu. Şu ana kadar toplam: ${totalUsersFound}. İşleniyor...`);

            // Process users on the current page
            for (let i = 0; i < pageUsernames.length; i++) {
              if (this.earlyStop) {
                log.info("progctrl", "Blocking muted users stopped early by user during page processing.");
                notificationHandler.notify(`Sessize alınan kullanıcıları engelleme işlemi kullanıcı tarafından durduruldu. İşlenen: ${processedCount} kullanıcı.`);
                break; // Exit the for loop
              }

              const username = pageUsernames[i];
              const authorIdFromPage = pageUserIds[i]; // Get ID from the partial scrape result
              processedCount++;

              // Update progress bar using notifyOngoing
              // Use unmutedCount for successful actions, processedCount for processed, totalUsersFound for total
              notificationHandler.notifyOngoing(unmutedCount, processedCount, totalUsersFound);

              log.info("progctrl", `Processing user: ${username}...`);

              // Step A: Get the user ID (use the one from the partial scrape if available, otherwise scrape profile)
              let authorId = authorIdFromPage;
              if (!authorId || authorId === "0") {
                 log.info("progctrl", `Scraping user ID for: ${username}...`);
                 authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(username);
              }


              if (!authorId || authorId === "0") {
                log.err("progctrl", `Could not get user ID for ${username}. Skipping.`);
                failedCount++;
                // No specific notification, failure counted
                continue; // Skip to the next user
              }

              log.info("progctrl", `Using user ID for ${username}: ${authorId}`);

              // Step B: Block the user
              log.info("progctrl", `Blocking user: ${username} (ID: ${authorId})...`);
              const blockResult = await this._performActionWithRetry(enums.BanMode.BAN, authorId, true, false, false);

              // Check if early stop was triggered during the retry
              if (blockResult.earlyStop) {
                log.info("progctrl", "Blocking muted users stopped early by user during block operation.");
                break; // Exit the for loop
              }

              if (blockResult.resultType !== enums.ResultType.SUCCESS) {
                log.err("progctrl", `Failed to block user: ${username} (ID: ${authorId})`);
                failedCount++;
                // No specific notification, failure counted
                continue; // Skip to the next user if block fails
              }

              log.info("progctrl", `Successfully blocked user: ${username} (ID: ${authorId})`);
              blockedCount++;
              // No specific notification, success counted


              // Step C: Unmute the user
              log.info("progctrl", `Unmuting user: ${username} (ID: ${authorId})...`);
              const unmuteResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, authorId, false, false, true);

              // Check if early stop was triggered during the retry
              if (unmuteResult.earlyStop) {
                log.info("progctrl", "Blocking muted users stopped early by user during unmute operation.");
                break; // Exit the for loop
              }

              if (unmuteResult.resultType !== enums.ResultType.SUCCESS) {
                log.err("progctrl", `Failed to unmute user: ${username} (ID: ${authorId})`);
                failedCount++; // Count as failed if unmute fails, even if block succeeded
                // No specific notification, failure counted
              } else {
                log.info("progctrl", `Successfully unmuted user: ${username} (ID: ${authorId})`);
                unmutedCount++;
                // Success counted, notifyOngoing will reflect this in the next iteration
                successfullyProcessedUsernames.push(username); // Add to list for storage update
              }

              // Small delay between users
              await utils.sleep(500); // Assuming a small delay is appropriate
            } // End for loop for users on current page

            // If early stop was triggered during the for loop, break the while loop as well
            if (this.earlyStop) {
                break;
            }

          } else {
            log.info("progctrl", `No users found on page ${pageIndex}. Assuming this is the last page.`);
            isLastPage = true; // Treat as last page if no users are found
          }

        } catch (pageError) {
          log.err("progctrl", `Error fetching or processing page ${pageIndex}: ${pageError.message || pageError}`);
          // Estimate failed count for the page - this is tricky with page-by-page processing.
          // A simpler approach is to just increment failedCount for the page itself or stop.
          // Let's just log the error and stop the process for now.
          failedCount++; // Count the page fetch/process as a failure
          notificationHandler.notify(`Sayfa ${pageIndex} işlenirken hata: ${pageError.message || "Bilinmeyen hata"}. Durduruluyor.`);
          break; // Exit the while loop on page error
        }

        // Add a polite delay between page requests, unless it's the last page or early stop
        if (!isLastPage && !this.earlyStop) {
           await utils.sleep(politeDelayMs);
        }
      } // End while loop for pages

      // Update muted user list in storage by removing successfully processed users
      if (successfullyProcessedUsernames.length > 0) {
          log.info("progctrl", `Removing ${successfullyProcessedUsernames.length} users from muted list storage.`);
          await storageHandler.removeMutedUsers(successfullyProcessedUsernames);
      }

      // Final status update using finishSuccess or finishErrorEarlyStop
      const totalProcessed = processedCount; // Total users processed in the loop
      if (this.earlyStop) {
          log.info("progctrl", `Blocking muted users stopped early. Successfully processed: ${unmutedCount}, Failed: ${failedCount}, Total Processed: ${totalProcessed}`);
          notificationHandler.finishErrorEarlyStop(enums.BanSource.BLOCK_MUTED_USERS, enums.BanMode.BAN, unmutedCount, totalProcessed, totalUsersFound); // Use BAN mode for the block action
      } else {
          const finalMessage = `Sessize alınan kullanıcıları engelleme tamamlandı. Başarıyla engellenip sessizden çıkarılan: ${unmutedCount}, Başarısız: ${failedCount}, Toplam işlenen: ${totalProcessed}`;
          log.info("progctrl", finalMessage);
          notificationHandler.finishSuccess(enums.BanSource.BLOCK_MUTED_USERS, enums.BanMode.BAN, unmutedCount, totalProcessed, totalUsersFound); // Use BAN mode for the block action
      }


    } catch (error) {
      log.err("progctrl", `An unexpected error occurred during blocking muted users: ${error}`, error);
      // Use notify for general error status before finally block
      notificationHandler.notify(`Sessize alınan kullanıcıları engelleme sırasında beklenmedik bir hata oluştu: ${error.message || "Bilinmeyen hata"}. İşlenen: ${processedCount} kullanıcı.`);
      // Consider adding a finishError call here if appropriate, depending on desired final state display
    } finally {
      log.info("progctrl", "blockMutedUsers function completed.");
      this.earlyStop = false; // Reset early stop flag in finally
      this._blockMutedUsersInProgress = false; // Reset flag in finally
      // Refresh muted and blocked user count display after the operation
      notificationHandler.notifyUpdateCounts();
    }
  }


  async blockTitlesOfBlockedMuted() {
    log.info("progctrl", "blockTitlesOfBlockedMuted function started.");

    if (this._blockTitlesInProgress) {
      log.warn("progctrl", "Blocking titles of blocked/muted users is already in progress.");
      notificationHandler.notify("Engellenen/sessize alınan kullanıcıların başlıklarını engelleme işlemi zaten devam ediyor.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start blocking titles while another operation is running.");
      notificationHandler.notify("Başka bir işlem çalışırken başlık engelleme başlatılamaz.");
      return;
    }

    this._blockTitlesInProgress = true;
    this.earlyStop = false;

    try {
      notificationHandler.notify("Engellenen ve sessize alınan kullanıcı listeleri getiriliyor...");

      // Get blocked users (assuming scrapingHandler can fetch all blocked users)
      const blockedUsersResult = await scrapingHandler.scrapeAllBlockedUsers();
      if (!blockedUsersResult.success) {
          log.err("progctrl", `Failed to fetch blocked users: ${blockedUsersResult.error}`);
          notificationHandler.notify(`Engellenen kullanıcılar getirilemedi: ${blockedUsersResult.error}`);
          return; // Stop the process if fetching blocked users fails
      }
      const blockedUsers = blockedUsersResult.usernames.map(username => ({ authorName: username, authorId: null })); // Create objects with placeholder ID
      log.info("progctrl", `Found ${blockedUsers.length} blocked users.`);

      // Get muted users (assuming storageHandler.getMutedUserList returns usernames)
      const mutedUsernames = await storageHandler.getMutedUserList();
      const mutedUsers = mutedUsernames ? mutedUsernames.map(username => ({ authorName: username, authorId: null })) : []; // Create objects with placeholder ID
      log.info("progctrl", `Found ${mutedUsers.length} muted users.`);

      // Combine lists. Need to handle potential duplicates if a user is both blocked and muted.
      // We'll prioritize blocked users if they have an ID.
      const combinedUsersMap = new Map();

      blockedUsers.forEach(user => {
        if (user.authorId) { // Prefer blocked user entry if ID is available
          combinedUsersMap.set(user.authorName, user);
        } else if (!combinedUsersMap.has(user.authorName)) {
           // Add if not already added and no ID was available from blocked list
           combinedUsersMap.set(user.authorName, user);
        }
      });

      mutedUsers.forEach(user => {
         if (!combinedUsersMap.has(user.authorName)) {
           // Add muted user only if not already in the map (from blocked list)
           combinedUsersMap.set(user.authorName, user);
         }
      });

      const usersToProcess = Array.from(combinedUsersMap.values());

      if (usersToProcess.length === 0) {
        log.info("progctrl", "No blocked or muted users found to process titles for.");
        notificationHandler.notify("Başlıkları işlenecek engellenmiş veya sessize alınmış kullanıcı bulunamadı.");
        return;
      }

      log.info("progctrl", `Found ${usersToProcess.length} unique blocked/muted users to process titles for.`);
      notificationHandler.notify(`${usersToProcess.length} benzersiz engellenmiş/sessize alınmış kullanıcı bulundu. Başlık engelleme işlemi başlatılıyor...`);

      let serverBlockedTitlesCount = 0; // Titles blocked via server API (for blocked users)
      let simulatedBlockedTitlesCount = 0; // Titles hidden client-side (for muted users)
      let usersProcessedCount = 0;
      let failedUsersCount = 0;
      let successfulUsersCount = 0; // New counter for users successfully processed

      // Initial progress notification
      notificationHandler.notifyOngoing(successfulUsersCount, usersProcessedCount, usersToProcess.length);


      for (let i = 0; i < usersToProcess.length; i++) {
        if (this.earlyStop) {
          log.info("progctrl", "Blocking titles stopped early by user.");
          notificationHandler.notify(`Başlık engelleme erken durduruldu. İşlenen kullanıcı: ${i}/${usersToProcess.length}.`);
          break;
        }

        const user = usersToProcess[i];
        // Determine if the user was originally in the blocked list (to decide on server vs client action)
        const isOriginallyBlocked = blockedUsers.some(blockedUser => blockedUser.authorName === user.authorName);

        // Update progress before processing each user
        notificationHandler.notifyOngoing(successfulUsersCount, usersProcessedCount, usersToProcess.length);


        log.info("progctrl", `Attempting to process titles for user: ${user.authorName} (ID: ${user.authorId || 'N/A'})...`);

        // Ensure user has an ID before attempting any action
        let authorId = user.authorId;
        if (!authorId || authorId === "0") {
            log.info("progctrl", `Scraping user ID for: ${user.authorName}...`);
            authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(user.authorName);

            if (!authorId || authorId === "0") {
                log.warn("progctrl", `Skipping title processing for user ${user.authorName} due to missing or invalid ID after scraping.`);
                failedUsersCount++;
                usersProcessedCount++;
                // Update progress after skipping a user
                notificationHandler.notifyOngoing(successfulUsersCount, usersProcessedCount, usersToProcess.length);
                continue; // Skip to the next user
            }
             log.info("progctrl", `Successfully scraped user ID for ${user.authorName}: ${authorId}`);
             user.authorId = authorId; // Update the user object with the scraped ID
        }


        let actionSuccessful = false; // Flag to track if the action for this user was successful

        if (isOriginallyBlocked) {
            // User was originally blocked, attempt server-side title block
            log.info("progctrl", `Attempting server-side title block for blocked user: ${user.authorName} (ID: ${user.authorId})...`);
            const blockResult = await this._performActionWithRetry(enums.BanMode.BAN, user.authorId, false, true, false);

            if (blockResult.earlyStop) {
              log.info("progctrl", "Blocking titles stopped early by user during server-side action.");
              break; // Exit the loop if early stop is triggered
            }

            if (blockResult.resultType !== enums.ResultType.SUCCESS) {
              log.err("progctrl", `Failed to block titles server-side for user: ${user.authorName} (ID: ${user.authorId})`);
              failedUsersCount++;
            } else {
              log.info("progctrl", `Successfully blocked titles server-side for user: ${user.authorName}`);
              serverBlockedTitlesCount++;
              actionSuccessful = true; // Mark action as successful
            }
        } else {
            // User is only muted, perform client-side title hiding
            log.info("progctrl", `Attempting client-side title hiding for muted user: ${user.authorName} (ID: ${user.authorId})...`);
            // Send message to content script to hide titles by this author ID
            try {
                const response = await chrome.tabs.sendMessage(this.tabId, {
                    action: "hideTitlesByAuthorId",
                    authorId: user.authorId
                });
                if (response && response.success) {
                    log.info("progctrl", `Successfully requested client-side hiding for user: ${user.authorName}. Hidden titles count: ${response.hiddenCount}`);
                    simulatedBlockedTitlesCount += response.hiddenCount;
                    actionSuccessful = true; // Mark action as successful
                } else {
                    log.warn("progctrl", `Client-side hiding request failed or returned no count for user: ${user.authorName}`);
                    failedUsersCount++; // Count as failed if client-side hiding fails
                }
            } catch (e) {
                log.err("progctrl", `Error sending client-side hiding message for user ${user.authorName}: ${e}`);
                failedUsersCount++; // Count as failed if message sending fails
            }
        }

        usersProcessedCount++;
        if (actionSuccessful) {
            successfulUsersCount++; // Increment successful users count
        }

        // Update progress after processing each user
        notificationHandler.notifyOngoing(successfulUsersCount, usersProcessedCount, usersToProcess.length);


        // Small delay between users
        await utils.sleep(500); // Assuming a small delay is appropriate
      }

      // Final status update
      const finalMessage = `Blocking titles completed. Successfully processed users: ${successfulUsersCount}, Failed users: ${failedUsersCount}, Total users processed: ${usersProcessedCount}. Simulated titles blocked: ${simulatedBlockedTitlesCount}.`;
      log.info("progctrl", finalMessage);

      if (this.earlyStop) {
          notificationHandler.finishErrorEarlyStop(enums.BanSource.BLOCKED_MUTED_TITLES, enums.BanMode.BAN); // Use the new BanSource
          // The notificationHandler.finishErrorEarlyStop function should handle displaying the final counts.
      } else {
          notificationHandler.finishSuccess(enums.BanSource.BLOCKED_MUTED_TITLES, enums.BanMode.BAN, successfulUsersCount, usersProcessedCount, usersToProcess.length); // Use the new BanSource
      }

    } catch (error) {
      log.err("progctrl", `An error occurred during blocking titles: ${error}`, error);
      // Use notify for error status, potentially including counts
      notificationHandler.notify(`Başlık engelleme sırasında bir hata oluştu: ${error.message}. İşlenen kullanıcı sayısı: ${usersProcessedCount}.`);
    } finally {
      log.info("progctrl", "blockTitlesOfBlockedMuted function completed.");
      this.earlyStop = false;
      this._blockTitlesInProgress = false; // Reset flag
      // No specific display update needed for this operation currently
    }
  }

  async migrateBlockedTitlesToUnblocked() {
    log.info("progctrl", "migrateBlockedTitlesToUnblocked function started.");

    if (this._blockTitlesInProgress) { // Reusing this flag for simplicity, could create a new one if needed
      log.warn("progctrl", "Unblocking blocked titles is already in progress.");
      notificationHandler.notify("Engellenen başlıkların engelini kaldırma işlemi zaten devam ediyor.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start unblocking titles while another operation is running.");
      notificationHandler.notify("Başka bir işlem çalışırken engellenen başlıkların engelini kaldırma başlatılamaz.");
      return;
    }

    this._blockTitlesInProgress = true; // Reusing flag
    this.earlyStop = false;

    try {
      notificationHandler.notify("Başlıkları engellenen kullanıcıların listesi getiriliyor...");

      const scrapeResult = await scrapingHandler.scrapeAllUsersWithBlockedTitles(
        (progress) => {
          // Optional: Update UI with list fetching progress if needed
          // notificationHandler.notifyProgress(`Fetching users with blocked titles: Page ${progress.currentPage}, Found ${progress.currentCount}`, progress.currentCount, totalCountPlaceholder); // Need total count
        }
      );

      if (!scrapeResult.success) {
        log.err("progctrl", `Failed to fetch list of users with blocked titles: ${scrapeResult.error}`);
        notificationHandler.notify(`Başlıkları engellenen kullanıcıların listesi getirilemedi: ${scrapeResult.error}`);
        return;
      }

      const usersWithBlockedTitles = scrapeResult.users;
      const totalCount = scrapeResult.count;

      if (usersWithBlockedTitles.length === 0) {
        log.info("progctrl", "No users with blocked titles found.");
        notificationHandler.notify("Başlıkları engellenen kullanıcı bulunamadı.");
        return;
      }
log.info("progctrl", `Successfully fetched list of ${totalCount} users with blocked titles. Starting unblocking process...`);
notificationHandler.notify(`${totalCount} adet başlıkları engellenen kullanıcı bulundu. Engel kaldırma işlemi başlatılıyor...`);



      let unblockedCount = 0;
      let failedCount = 0;

      // Process users to unblock their titles
      for (let i = 0; i < usersWithBlockedTitles.length; i++) {
        if (this.earlyStop) {
          log.info("progctrl", "Unblocking titles stopped early by user.");
          notificationHandler.notify(`Başlık engeli kaldırma erken durduruldu. İşlenen kullanıcı: ${i}/${usersWithBlockedTitles.length}.`);
          break;
        }
 
         const user = usersWithBlockedTitles[i];
         const currentProgress = i + 1;
         const totalUsers = usersWithBlockedTitles.length;
 
         // Use notifyOngoing for progress updates
         notificationHandler.notifyOngoing(unblockedCount, currentProgress, totalUsers);
 
         log.info("progctrl", `Unblocking titles for user: ${user.authorName} (ID: ${user.authorId})...`);
 
         // Perform the unblocking action for titles associated with this user ID
         // Note: The API unblocks *all* titles by this user if any were blocked via the relation-list endpoint.
         const unblockResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, user.authorId, false, true, false);
 
         // Check if early stop was triggered during the retry
         if (unblockResult.earlyStop) {
           log.info("progctrl", "Unblocking titles stopped early by user during action.");
           break;
         }
 
         if (unblockResult.resultType !== enums.ResultType.SUCCESS) {
           log.err("progctrl", `Failed to unblock titles for user: ${user.authorName}`);
           failedCount++;
         } else {
           log.info("progctrl", `Successfully unblocked titles for user: ${user.authorName}`);
           unblockedCount++;
         }
 
         // Small delay between users
         await utils.sleep(500); // Assuming a small delay is appropriate
       }
  
       // Final status update using finishSuccess or finishErrorEarlyStop
       const totalProcessed = unblockedCount + failedCount;
       if (this.earlyStop) {
           log.info("progctrl", `Unblocking titles stopped early. Unblocked: ${unblockedCount}, Failed: ${failedCount}, Total Processed: ${totalProcessed}`);
           notificationHandler.finishErrorEarlyStop(enums.BanSource.TITLE, enums.BanMode.UNDOBAN, unblockedCount, totalProcessed, usersWithBlockedTitles.length); // Use TITLE source and UNDOBAN mode
       } else {
           const finalMessage = `Durum: Engellenen başlıkların engeli kaldırıldı. Başarıyla engeli kaldırılan kullanıcılar: ${unblockedCount}, Başarısız kullanıcılar: ${failedCount}, Toplam işlenen kullanıcı: ${totalProcessed}`;
           log.info("progctrl", finalMessage);
           notificationHandler.finishSuccess(enums.BanSource.TITLE, enums.BanMode.UNDOBAN, unblockedCount, totalProcessed, usersWithBlockedTitles.length); // Use TITLE source and UNDOBAN mode
       }
  
     } catch (error) {
       log.err("progctrl", `An error occurred during unblocking blocked titles: ${error}`, error);
       // Use notify for general error status before finally block
       notificationHandler.notify(`Engellenen başlıkların engeli kaldırılırken bir hata oluştu: ${error.message}`);
       // Consider adding a finishError call here if appropriate, depending on desired final state display
     } finally {
       log.info("progctrl", "migrateBlockedTitlesToUnblocked function completed.");
       this.earlyStop = false; // Reset early stop flag in finally
       this._blockTitlesInProgress = false; // Reset flag in finally
       // Refresh relevant counts if needed
       // notificationHandler.updateBlockedTitleCountDisplay(); // Assuming a function like this exists or is needed
     }
   }
 
 }
 
 export const programController = new ProgramController();
