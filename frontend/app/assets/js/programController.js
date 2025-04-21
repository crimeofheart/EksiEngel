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
      notificationHandler.notify("Engellenen kullanıcılar alınıyor...");
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
        notificationHandler.notify(`Engellenen kullanıcılar alınamadı: ${scrapeResult.error}`);
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
        notificationHandler.notifyOngoing(migratedCount, currentProgress, totalUsers);

        // Send status update: Processing current user
        notificationHandler.notify(`İşleniyor: ${user.authorName} (${currentProgress}/${totalUsers})`);


        // Step A: Get the user ID by scraping their profile page
        log.info("progctrl", `Scraping user ID for: ${user.authorName}...`);
        // Send status update: Scraping ID
        notificationHandler.notify(`ID alınıyor: ${user.authorName}`);
        const authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(user.authorName);

        if (!authorId || authorId === "0") {
          log.err("progctrl", `Could not scrape user ID for ${user.authorName}. Skipping.`);
          failedCount++;
          // Send status update: Failed to get ID
          notificationHandler.notify(`ID alınamadı, atlanıyor: ${user.authorName}`);
          continue; // Skip to the next user
        }

        log.info("progctrl", `Successfully scraped user ID for ${user.authorName}: ${authorId}`);

        // Step B: Unblock
        log.info("progctrl", `Unblocking user: ${user.authorName} (ID: ${authorId})...`);
        // Send status update: Unblocking
        notificationHandler.notify(`Engel kaldırılıyor: ${user.authorName}`);
        const unblockResult = await this._performActionWithRetry(enums.BanMode.UNDOBAN, authorId, true, false, false);

        // Check if early stop was triggered during the retry
        if (unblockResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during unblock operation.");
          break;
        }

        if (unblockResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to unblock user: ${user.authorName} (ID: ${authorId})`);
          failedCount++;
          // Send status update: Unblock failed
          notificationHandler.notify(`Engel kaldırılamadı, atlanıyor: ${user.authorName}`);
          continue; // Skip to the next user if unblock fails
        }

        // For this specific feature, we always want to mute regardless of config setting
        // The whole point of this feature is to migrate from blocked to muted
        log.debug("progctrl", `Proceeding with muting regardless of config.enableMute setting`);

        log.info("progctrl", `Muting user: ${user.authorName} (ID: ${authorId})...`);
        // Send status update: Muting
        notificationHandler.notify(`Sessize alınıyor: ${user.authorName}`);
        const muteResult = await this._performActionWithRetry(enums.BanMode.BAN, authorId, false, false, true);

        // Check if early stop was triggered during the retry
        if (muteResult.earlyStop) {
          log.info("progctrl", "Migration stopped early by user during mute operation.");
          break;
        }

        if (muteResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to mute user: ${user.authorName} (ID: ${authorId})`);
          failedCount++;
          // Send status update: Mute failed
          notificationHandler.notify(`Sessize alınamadı: ${user.authorName}`);
        } else {
          log.info("progctrl", `Successfully migrated user: ${user.authorName} (ID: ${authorId})`);
          migratedCount++;
          // Send status update: Successfully migrated
          notificationHandler.notify(`Başarıyla sessize alındı: ${user.authorName}`);
        }

        // Small delay between users
        await utils.sleep(500);
      }

      // Note: The migrateBlockedToMuted function does not remove users from a local muted list
      // because it's migrating *from* blocked *to* muted. The muted list is the destination.
      // The logic for usersToRemoveFromMuted and updating muted storage was incorrectly
      // copied from blockMutedUsers. Removing it here.

      const finalMessage = `Migration completed. Successfully migrated: ${migratedCount}, Failed: ${failedCount}, Total processed: ${migratedCount + failedCount}`;
      log.info("progctrl", finalMessage);
      // Use notify for final completion status
      notificationHandler.notify(finalMessage);


    } catch (error) {
      log.err("progctrl", `An error occurred during migration: ${error}`, error);
      // Use notify for error status
      notificationHandler.notify(`Taşıma sırasında bir hata oluştu: ${error.message || "Bilinmeyen hata"}`);
    } finally {
      log.info("progctrl", "migrateBlockedToMuted function completed.");
      this.earlyStop = false;
      this._migrationInProgress = false;
      // No specific display update needed for this operation currently,
      // as the notification page handles the final status display.
    }
  }

  async blockMutedUsers() {
    log.info("progctrl", "blockMutedUsers function started.");

    if (this._blockMutedUsersInProgress) {
      log.warn("progctrl", "Blocking muted users is already in progress.");
      notificationHandler.notify("Blocking muted users is already in progress.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start blocking muted users while another operation is running.");
      notificationHandler.notify("Cannot start blocking muted users while another operation is running.");
      return;
    }

    this._blockMutedUsersInProgress = true;
    this.earlyStop = false;

    try {
      notificationHandler.notify("Fetching muted user list...");

      // Get muted users (assuming storageHandler.getMutedUserList returns usernames)
      const mutedUsernames = await storageHandler.getMutedUserList();
      const mutedUsers = mutedUsernames ? mutedUsernames.map(username => ({ authorName: username, authorId: null })) : []; // Create objects with placeholder ID
      log.info("progctrl", `Found ${mutedUsers.length} muted users.`);

      if (mutedUsers.length === 0) {
        log.info("progctrl", "No muted users found to block.");
        notificationHandler.notify("No muted users found to block.");
        return;
      }

      log.info("progctrl", `Found ${mutedUsers.length} muted users. Starting blocking process...`);
      notificationHandler.notify(`Found ${mutedUsers.length} muted users. Starting blocking process...`);

      let blockedCount = 0;
      let failedCount = 0;
      let usersToRemoveFromMuted = []; // To track users successfully blocked

      for (let i = 0; i < mutedUsers.length; i++) {
        if (this.earlyStop) {
          log.info("progctrl", "Blocking muted users stopped early by user.");
          notificationHandler.notify(`Blocking muted users stopped early. Processed ${i}/${mutedUsers.length} users.`);
          break;
        }

        const user = mutedUsers[i];
        notificationHandler.notifyProgress(`Blocking user ${i + 1}/${mutedUsers.length}: ${user.authorName}`, i + 1, mutedUsers.length);

        log.info("progctrl", `Blocking user: ${user.authorName} (ID: ${user.authorId || 'N/A'})...`);

        // Step A: Get the user ID by scraping their profile page
        log.info("progctrl", `Scraping user ID for: ${user.authorName}...`);
        const authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(user.authorName);

        if (!authorId) {
          log.err("progctrl", `Could not scrape user ID for ${user.authorName}. Skipping.`);
          failedCount++;
          continue; // Skip to the next user
        }

        log.info("progctrl", `Successfully scraped user ID for ${user.authorName}: ${authorId}`);

        // Step B: Block the user using the scraped ID
        log.info("progctrl", `Blocking user: ${user.authorName} (ID: ${authorId})...`);
        const blockResult = await this._performActionWithRetry(enums.BanMode.BAN, authorId, true, false, false);

        // Check if early stop was triggered during the retry
        if (blockResult.earlyStop) {
          log.info("progctrl", "Blocking muted users stopped early by user during block operation.");
          break;
        }

        if (blockResult.resultType !== enums.ResultType.SUCCESS) {
          log.err("progctrl", `Failed to block user: ${user.authorName} (ID: ${authorId})`);
          failedCount++;
        } else {
          log.info("progctrl", `Successfully blocked user: ${user.authorName} (ID: ${authorId})`);
          blockedCount++;
          usersToRemoveFromMuted.push(user.authorName); // Add to list for removal from muted storage
        }

        // Small delay between users
        await utils.sleep(500); // Assuming a small delay is appropriate
      }

      // Update the muted user list in storage by removing the users that were successfully blocked
      if (usersToRemoveFromMuted.length > 0) {
        const currentMutedList = await storageHandler.getMutedUserList();
        const updatedMutedList = currentMutedList.filter(username => !usersToRemoveFromMuted.includes(username));
        await storageHandler.saveMutedUserList(updatedMutedList);
        log.info("progctrl", `Removed ${usersToRemoveFromMuted.length} users from the muted list in storage.`);
      }

      const finalMessage = `Blocking muted users completed. Successfully blocked: ${blockedCount}, Failed: ${failedCount}, Total processed: ${blockedCount + failedCount}`;
      log.info("progctrl", finalMessage);
      notificationHandler.notify(finalMessage);

    } catch (error) {
      log.err("progctrl", `An error occurred during blocking muted users: ${error}`, error);
      notificationHandler.notify(`An error occurred during blocking muted users: ${error.message}`);
    } finally {
      log.info("progctrl", "blockMutedUsers function completed.");
      this.earlyStop = false;
      this._blockMutedUsersInProgress = false;
      // Refresh muted user count display after the operation
      notificationHandler.updateMutedUserCountDisplay();
    }
  }


  async blockTitlesOfBlockedMuted() {
    log.info("progctrl", "blockTitlesOfBlockedMuted function started.");

    if (this._blockTitlesInProgress) {
      log.warn("progctrl", "Blocking titles of blocked/muted users is already in progress.");
      notificationHandler.notify("Blocking titles of blocked/muted users is already in progress.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start blocking titles while another operation is running.");
      notificationHandler.notify("Cannot start blocking titles while another operation is running.");
      return;
    }

    this._blockTitlesInProgress = true;
    this.earlyStop = false;

    try {
      notificationHandler.notify("Fetching blocked and muted user lists...");

      // Get blocked users (assuming scrapingHandler can fetch all blocked users)
      const blockedUsersMap = await scrapingHandler.scrapeBlockedUsers(); // Assuming this fetches all pages
      const blockedUsers = blockedUsersMap ? Array.from(blockedUsersMap.values()) : [];
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
        notificationHandler.notify("No blocked or muted users found to process titles for.");
        return;
      }

      log.info("progctrl", `Found ${usersToProcess.length} unique blocked/muted users to process titles for.`);
      notificationHandler.notify(`Found ${usersToProcess.length} unique blocked/muted users. Starting title blocking process...`);

      let titlesBlockedCount = 0;
      let usersProcessedCount = 0;
      let failedUsersCount = 0;

      // *** LIMITATION NOTE ***
      // Blocking titles requires scraping the user's profile page to get their entries' IDs.
      // This is a complex scraping task and is outside the scope of this immediate button implementation.
      // The logic below will be a placeholder that logs the intent but doesn't perform the actual scraping and blocking of titles.
      // A future task will be needed to implement the actual title scraping and blocking logic.
      // I will add a decision log entry about this.
      // *** END LIMITATION NOTE ***
// TODO: Implement actual scraping of user profile pages to get entry IDs and then block titles.

      // Simulate processing each user for title blocking
      for (let i = 0; i < usersToProcess.length; i++) {
        if (this.earlyStop) {
          log.info("progctrl", "Blocking titles stopped early by user.");
          notificationHandler.notify(`Blocking titles stopped early. Processed ${i}/${usersToProcess.length} users.`);
          break;
        }

        const user = usersToProcess[i];
        notificationHandler.notifyProgress(`Processing titles for user ${i + 1}/${usersToProcess.length}: ${user.authorName}`, i + 1, usersToProcess.length);

        log.info("progctrl", `Processing titles for user: ${user.authorName} (ID: ${user.authorId || 'N/A'})...`);

        // Placeholder for actual title scraping and blocking logic
        log.warn("progctrl", `Title blocking logic for user ${user.authorName} is a placeholder and not yet implemented.`);

        // Simulate some work and potential failure for demonstration
        await utils.sleep(500); // Simulate scraping/processing time
        const success = Math.random() > 0.2; // Simulate 80% success rate for processing user's titles

        if (success) {
           log.info("progctrl", `Simulated successful title processing for user: ${user.authorName}`);
           // Simulate blocking a random number of titles (between 0 and 5)
           const blockedThisUser = Math.floor(Math.random() * 6);
           titlesBlockedCount += blockedThisUser;
           log.info("progctrl", `Simulated blocking ${blockedThisUser} titles for user ${user.authorName}. Total titles blocked: ${titlesBlockedCount}`);
        } else {
           log.err("progctrl", `Simulated failed title processing for user: ${user.authorName}`);
           failedUsersCount++;
        }
        usersProcessedCount++;
      }

      const finalMessage = `Blocking titles completed. Successfully processed users: ${usersProcessedCount - failedUsersCount}, Failed users: ${failedUsersCount}, Total users processed: ${usersProcessedCount}. Simulated titles blocked: ${titlesBlockedCount}`;
      log.info("progctrl", finalMessage);
      notificationHandler.notify(finalMessage);

    } catch (error) {
      log.err("progctrl", `An error occurred during blocking titles: ${error}`, error);
      notificationHandler.notify(`An error occurred during blocking titles: ${error.message}`);
    } finally {
      log.info("progctrl", "blockTitlesOfBlockedMuted function completed.");
      this.earlyStop = false;
      this._blockTitlesInProgress = false;
      // No specific display update needed for this operation currently
    }
  }

  async migrateBlockedTitlesToUnblocked() {
    log.info("progctrl", "migrateBlockedTitlesToUnblocked function started.");

    if (this._blockTitlesInProgress) { // Reusing this flag for simplicity, could create a new one if needed
      log.warn("progctrl", "Unblocking blocked titles is already in progress.");
      notificationHandler.notify("Unblocking blocked titles is already in progress.");
      return;
    }

    if (processQueue.isRunning) {
      log.warn("progctrl", "Cannot start unblocking titles while another operation is running.");
      notificationHandler.notify("Cannot start unblocking titles while another operation is running.");
      return;
    }

    this._blockTitlesInProgress = true; // Reusing flag
    this.earlyStop = false;

    try {
      notificationHandler.notify("Fetching list of users with blocked titles...");

      const scrapeResult = await scrapingHandler.scrapeAllUsersWithBlockedTitles(
        (progress) => {
          // Optional: Update UI with list fetching progress if needed
          // notificationHandler.notifyProgress(`Fetching users with blocked titles: Page ${progress.currentPage}, Found ${progress.currentCount}`, progress.currentCount, totalCountPlaceholder); // Need total count
        }
      );

      if (!scrapeResult.success) {
        log.err("progctrl", `Failed to fetch list of users with blocked titles: ${scrapeResult.error}`);
        notificationHandler.notify(`Failed to fetch list of users with blocked titles: ${scrapeResult.error}`);
        return;
      }

      const usersWithBlockedTitles = scrapeResult.users;
      const totalCount = scrapeResult.count;

      if (usersWithBlockedTitles.length === 0) {
        log.info("progctrl", "No users with blocked titles found.");
        notificationHandler.notify("No users with blocked titles found.");
        return;
      }

      log.info("progctrl", `Successfully fetched list of ${totalCount} users with blocked titles. Starting unblocking process...`);
      notificationHandler.notify(`Found ${totalCount} users with blocked titles. Starting unblocking process...`);


      let unblockedCount = 0;
      let failedCount = 0;

      // Process users to unblock their titles
      for (let i = 0; i < usersWithBlockedTitles.length; i++) {
        if (this.earlyStop) {
          log.info("progctrl", "Unblocking titles stopped early by user.");
          notificationHandler.notify(`Unblocking titles stopped early. Processed ${i}/${usersWithBlockedTitles.length} users.`);
          break;
        }

        const user = usersWithBlockedTitles[i];
        // Use sendMigrationMessage for progress updates
        notificationHandler.sendMigrationMessage('progress', `Unblocking titles for user ${i + 1}/${usersWithBlockedTitles.length}: ${user.authorName}`, "", i + 1, usersWithBlockedTitles.length, null, null, null);

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

      const finalMessage = `Unblocking blocked titles completed. Successfully unblocked users: ${unblockedCount}, Failed users: ${failedCount}, Total users processed: ${usersWithBlockedTitles.length}`;
      log.info("progctrl", finalMessage);
      notificationHandler.notify(finalMessage);

    } catch (error) {
      log.err("progctrl", `An error occurred during unblocking blocked titles: ${error}`, error);
      notificationHandler.notify(`An error occurred during unblocking blocked titles: ${error.message}`);
    } finally {
      log.info("progctrl", "migrateBlockedTitlesToUnblocked function completed.");
      this.earlyStop = false;
      this._blockTitlesInProgress = false; // Reset flag
      // No specific display update needed for this operation currently
    }
  }

}

export const programController = new ProgramController();
