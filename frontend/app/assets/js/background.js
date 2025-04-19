'use strict';

import * as enums from './enums.js';
import * as utils from './utils.js';
import {config, getConfig, saveConfig, handleConfig} from './config.js';
import {log} from './log.js';
import {Action, createEksiSozlukEntry, createEksiSozlukTitle, createEksiSozlukUser, commHandler, ActionConfig} from './commHandler.js';
import {relationHandler} from './relationHandler.js';
import {scrapingHandler} from './scrapingHandler.js';
import {processQueue} from './queue.js';
import {programController} from './programController.js';
import {handleEksiSozlukURL} from './urlHandler.js';
import { notificationHandler } from './notificationHandler.js';
import { storageHandler } from './storageHandler.js';

log.info("bg", "initialized");
let g_notificationTabId = 0;

chrome.runtime.onMessage.addListener(async function messageListener_Popup(message, sender, sendResponse) {
  log.info("bg", "Received message:", message);

  const actionsRequiringNotification = ["startMigration", "startTitleMigration", "refreshMutedList"];

  // Check if the message requires the notification tab
  if (message && actionsRequiringNotification.includes(message.action)) {
    log.info("bg", `Handling action ${message.action} requiring notification tab.`);

    // --- Ensure Notification Tab Exists (Standard Logic) ---
    try {
      let tabExists = false;
      if (g_notificationTabId) { // Check if we have a stored ID
        try {
          await chrome.tabs.get(g_notificationTabId);
          tabExists = true; // Tab still exists
        } catch (e) {
          log.warn("bg", "Stored notification tab ID not found, creating new one.");
          g_notificationTabId = 0; // Reset ID
        }
      }
      if (!tabExists) {
         // Check if any notification tab is already open (e.g., after browser restart)
         const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("assets/html/notification.html") });
         if (tabs && tabs.length > 0) {
             g_notificationTabId = tabs[0].id;
             log.info("bg", `Found existing notification tab: ${g_notificationTabId}`);
         } else {
             // Create a new tab if none exists
             const notificationUrl = chrome.runtime.getURL("assets/html/notification.html");
             const tab = await chrome.tabs.create({ active: false, url: notificationUrl });
             g_notificationTabId = tab.id;
             log.info("bg", `Created new notification tab: ${g_notificationTabId} for ${message.action}`);
         }
      }
      programController.tabId = g_notificationTabId; // Set the ID in programController

      // Wait for the notification page to be fully loaded before proceeding
      log.info("bg", "Waiting for notification page to be ready...");

      // Create a promise that resolves when the notification page is ready
      const waitForNotificationPage = new Promise((resolve, reject) => {
        // Set a timeout to avoid waiting forever
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for notification page to load"));
        }, 5000); // 5 second timeout

        // Listen for a ready message from the notification page
        const messageListener = (message, sender) => {
          if (sender.tab && sender.tab.id === g_notificationTabId &&
              message && message.action === "notificationPageReady") {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(messageListener);
            resolve();
          }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Also try to send a ping to see if the page is already loaded
        try {
          chrome.tabs.sendMessage(g_notificationTabId, { action: "ping" }, response => {
            // Check for runtime.lastError to prevent uncaught errors in the console
            if (chrome.runtime.lastError) {
              // This is expected if the page isn't loaded yet, so just log it
              log.info("bg", "Ping failed, waiting for ready message: " + chrome.runtime.lastError.message);
              return;
            }

            if (response && response.status === "ok") {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              resolve();
            }
          });
        } catch (e) {
          // Ignore errors here, we'll wait for the ready message
          log.warn("bg", `Error sending ping to notification tab: ${e}`);
        }
      });

      try {
        await waitForNotificationPage;
        log.info("bg", "Notification page is ready.");
      } catch (e) {
        log.warn("bg", `Timed out waiting for notification page: ${e}. Proceeding anyway.`);
        // We'll proceed even if we time out, as the page might still load
      }

    } catch (e) {
      log.err("bg", `Error handling notification tab before ${message.action}: ${e}`);
      sendResponse({ status: 'error', message: 'Could not open notification page.' });
      return; // Abort if we can't ensure notification page exists
    }
    // --- End Notification Tab Handling ---

    if (message.action === "startMigration" || message.action === "startTitleMigration") {
      const isTitleMigration = message.action === "startTitleMigration";
      log.info("bg", `Handling ${isTitleMigration ? "title " : ""}migration request from popup.`);

      // Call the appropriate migration function (they handle checks internally)
      if (isTitleMigration) {
        programController.migrateBlockedTitlesToUnblocked();
      } else {
        programController.migrateBlockedToMuted();
      }

      // Send response immediately for this message type
      sendResponse({ status: 'ok', message: `${isTitleMigration ? "Title migration" : "Migration"} initiated` });
      return; // Don't process further as a standard ban/unban
    } else if (message.action === "refreshMutedList") {
      log.info("bg", "Handling refreshMutedList request from popup.");

      // Define a function to send progress updates to the notification page
      const updateProgress = (progress) => {
        chrome.tabs.sendMessage(g_notificationTabId, {
          action: "updateMutedListProgress",
          ...progress // currentPage, currentCount
        });
      };

      // Call scrapeAllMutedUsers with the progress callback
      try {
        const result = await scrapingHandler.scrapeAllMutedUsers(updateProgress);

        if (result.success) {
          await storageHandler.saveMutedUserList(result.usernames);
          log.info("bg", `Successfully scraped and saved ${result.count} muted users.`);
          // Send final success message to notification page
          chrome.tabs.sendMessage(g_notificationTabId, {
            action: "mutedListRefreshComplete",
            success: true,
            count: result.count
          });
        } else {
          log.err("bg", "Error scraping muted users:", result.error);
          // Send error message to notification page
          chrome.tabs.sendMessage(g_notificationTabId, {
            action: "mutedListRefreshComplete",
            success: false,
            error: result.error
          });
        }
      } catch (e) {
        log.err("bg", `Unexpected error during refreshMutedList: ${e}`);
        chrome.tabs.sendMessage(g_notificationTabId, {
          action: "mutedListRefreshComplete",
          success: false,
          error: e.message || "Unknown error"
        });
      } finally {
        // Send a response to the popup (even if there was an error)
        sendResponse({ status: 'ok', message: 'Refresh initiated' });
      }
      return; // Stop further processing of this message
    }
  }

  // Handle early stop message
  if (message && message.earlyStop !== undefined) {
    log.info("bg", "Received early stop message");
    programController.earlyStop = true;
    sendResponse({status: 'ok', message: 'Early stop received'});
    return; // Don't process further
  }

  // Existing logic for standard ban/unban operations
  // Ensure response is sent if it wasn't a migration message
  sendResponse({status: 'ok'});

 const obj = utils.filterMessage(message, "banSource", "banMode");
 if(obj.resultType === enums.ResultType.FAIL) {
    // If it's not a migration message and doesn't fit the banSource/banMode structure, ignore it.
    log.info("bg", "Received message doesn't match known action types.");
  return;
  }
	
  log.info("bg", "a new process added to the queue, banSource: " + obj.banSource + ", banMode: " + obj.banMode);
  let wrapperProcessHandler = processHandler.bind(null, obj.banSource, obj.banMode, obj.entryUrl, obj.authorName, obj.authorId, obj.targetType, obj.clickSource, obj.titleName, obj.titleId, obj.timeSpecifier);
  wrapperProcessHandler.banSource = obj.banSource; // Keep associating metadata for queue display if needed
  wrapperProcessHandler.banMode = obj.banMode;
  wrapperProcessHandler.creationDateInStr = new Date().getHours() + ":" + new Date().getMinutes(); 
  processQueue.enqueue(wrapperProcessHandler);
  log.info("bg", "number of waiting processes in the queue: " + processQueue.size);
  notificationHandler.updatePlannedProcessesList(processQueue.itemAttributes);
});

async function processHandler(banSource, banMode, entryUrl, singleAuthorName, singleAuthorId, targetType, clickSource, titleName, titleId, timeSpecifier)
{
  log.info("bg", "Process has been started with " + 
           "banSource: "          + banSource + 
           ", banMode: "          + banMode + 
           ", entryUrl: "         + entryUrl + 
           ", singleAuthorName: " + singleAuthorName + 
           ", singleAuthorId: "   + singleAuthorId +
           ", targetType: "       + targetType +
           ", clickSource: "      + clickSource +
           ", titleName: "        + titleName +
           ", titleId: "          + titleId
           );
  
  // create a notification page if not exist
  try
  {
    let tab2 = await chrome.tabs.get(g_notificationTabId);
  }
  catch(e)
  {
    // not exist, so create one
    let tab = await chrome.tabs.create({ active: false, url: chrome.runtime.getURL("assets/html/notification.html") });
    g_notificationTabId = tab.id;
  }
  programController.tabId = g_notificationTabId;
  notificationHandler.updatePlannedProcessesList(processQueue.itemAttributes);

  let authorNameList = [];
  let authorIdList = [];
  let entryMetaData = {};
  
  await handleConfig(); // load config
  relationHandler.reset(); // reset the counters to reuse

  notificationHandler.notifyControlAccess();
  const isEksiSozlukAccessible = await handleEksiSozlukURL();
  if(!isEksiSozlukAccessible)
  {
    log.err("bg", "Program has been finished (finishErrorAccess)");
    notificationHandler.finishErrorAccess(banSource, banMode);
    return;
  }

  notificationHandler.notifyControlLogin();
  let userAgent = await scrapingHandler.scrapeUserAgent();
  const {clientName, clientId} = await scrapingHandler.scrapeClientNameAndId(); 
  if(!clientName)
  {
    log.err("bg", "Program has been finished (finishErrorLogin)");
    notificationHandler.finishErrorLogin(banSource, banMode);
    return;
  }
  
  if(banSource === enums.BanSource.SINGLE)
  {
    notificationHandler.notifyOngoing(0, 0, 1);
    
    let res = await relationHandler.performAction(banMode, singleAuthorId, targetType == enums.TargetType.USER, targetType == enums.TargetType.TITLE, targetType == enums.TargetType.MUTE);
    authorIdList.push(singleAuthorId);
    authorNameList.push(singleAuthorName);
    
    if(res.resultType == enums.ResultType.FAIL)
    {
      // performAction failed because to too many request

      // while waiting cooldown, send periodic notifications to user 
      // this also provides that chrome doesn't kill the extension for being idle
      await new Promise(async resolve => 
      {
        // wait 1 minute (+2 sec to ensure)
        let waitTimeInSec = 62;
        for(let i = 1; i <= waitTimeInSec; i++)
        {
          if(programController.earlyStop)
            break;
          
          notificationHandler.notifyCooldown(waitTimeInSec-i);
          
          // wait 1 sec
          await new Promise(resolve2 => { setTimeout(resolve2, 1000); }); 
        }
          
        resolve();        
      }); 
      
      if(!programController.earlyStop)
        res = await relationHandler.performAction(banMode, singleAuthorId, targetType == enums.TargetType.USER, targetType == enums.TargetType.TITLE, targetType == enums.TargetType.MUTE);
    }
    
    notificationHandler.notifyOngoing(res.successfulAction, res.performedAction, authorNameList.length);
  }
  else if(banSource === enums.BanSource.LIST)
  {
    authorNameList = await utils.getUserList(); // names will be loaded from storage
    utils.cleanUserList(authorNameList);
    
    // stop if there is no user
    log.info("bg", "number of user to ban " + authorNameList.length);
    if(authorNameList.length === 0)
    {
      notificationHandler.finishErrorNoAccount(banSource, banMode);
      log.err("bg", "Program has been finished (finishErrorNoAccount)");
      return;
    }

    notificationHandler.notifyOngoing(0, 0, authorNameList.length);
    
    for (let i = 0; i < authorNameList.length; i++)
    {
      if(programController.earlyStop)
        break;
      
      let authorId = await scrapingHandler.scrapeAuthorIdFromAuthorProfilePage(authorNameList[i]);
      authorIdList.push(authorId);
      
      let res;
      if(banMode == enums.BanMode.BAN)
        res = await relationHandler.performAction(banMode, authorId, !config.enableMute, config.enableTitleBan, config.enableMute);
      else
        res = await relationHandler.performAction(banMode, authorId, true, true, true);
      
      if(res.resultType == enums.ResultType.FAIL)
      {
        // performAction failed because to too many request

        // while waiting cooldown, send periodic notifications to user 
        // this also provides that chrome doesn't kill the extension for being idle
        await new Promise(async resolve => 
        {
          // wait 1 minute (+2 sec to ensure)
          let waitTimeInSec = 62;
          for(let i = 1; i <= waitTimeInSec; i++)
          {
            if(programController.earlyStop)
              break;
            
            // send message to notification page
            notificationHandler.notifyCooldown(waitTimeInSec-i);
            
            // wait 1 sec
            await new Promise(resolve2 => { setTimeout(resolve2, 1000); }); 
          }
            
          resolve();        
        }); 
        
        if(!programController.earlyStop)
        {
          if(banMode == enums.BanMode.BAN)
            res = await relationHandler.performAction(banMode, authorId, !config.enableMute, config.enableTitleBan, config.enableMute);
          else
            res = await relationHandler.performAction(banMode, authorId, true, true, true);
        }
      }

      // send message to notification page
      notificationHandler.notifyOngoing(res.successfulAction, res.performedAction, authorNameList.length);
    }
    
  }
  else if(banSource === enums.BanSource.FAV)
  {
    notificationHandler.notifyScrapeFavs();

    entryMetaData = await scrapingHandler.scrapeMetaDataFromEntryPage(entryUrl);
    let scrapedRelations = await scrapingHandler.scrapeAuthorNamesFromFavs(entryUrl); // names will be scraped
    
    log.info("bg", "number of user to ban (before analysis): " + scrapedRelations.size);
    
    // stop if there is no user
    if(scrapedRelations.size === 0)
    {
      notificationHandler.finishErrorNoAccount(banSource, banMode);
      log.err("bg", "Program has been finished (error_NoAccount)");
      return;
    }
    
    // analysis before operation 
    if(config.enableAnalysisBeforeOperation && config.enableProtectFollowedUsers && banMode == enums.BanMode.BAN)
    {
      // scrape the authors that ${clientName} follows
      notificationHandler.notifyScrapeFollowings();
      let mapFollowing = await scrapingHandler.scrapeFollowing(clientName);
      
      // remove the authors that ${clientName} follows from the list to protect    
      notificationHandler.notifyAnalysisProtectFollowedUsers();  
      for (let name of scrapedRelations.keys()) {
        if (mapFollowing.has(name))
          scrapedRelations.delete(name);
      }
    }
    if(config.enableAnalysisBeforeOperation && config.enableOnlyRequiredActions)
    {
      // scrape the authors that ${clientName} blocked
      notificationHandler.notifyScrapeBanned();
      let mapBlocked = await scrapingHandler.scrapeAuthorNamesFromBannedAuthorPage();
      
      // update the list with info obtained from mapBlocked
      notificationHandler.notifyAnalysisOnlyRequiredActions();
      for (let name of scrapedRelations.keys()) {
        if (mapBlocked.has(name))
        {
          scrapedRelations.get(name).isBannedUser = mapBlocked.get(name).isBannedUser;
          scrapedRelations.get(name).isBannedTitle = mapBlocked.get(name).isBannedTitle;
          scrapedRelations.get(name).isBannedMute = mapBlocked.get(name).isBannedMute;
        }
      }
    }
      
    log.info("bg", "number of user to ban (after analysis): " + scrapedRelations.size);
    
    // stop if there is no user
    if(scrapedRelations.size === 0)
    {
      notificationHandler.finishErrorNoAccount(banSource, banMode);
      log.err("bg", "Program has been finished (error_NoAccount)");
      return;
    }

    authorNameList = Array.from(scrapedRelations, ([name, value]) => name);
    authorIdList = Array.from(scrapedRelations, ([name, value]) => value.authorId);

    notificationHandler.notifyOngoing(0, 0, authorNameList.length);
    
    for (const [name, value] of scrapedRelations)
    {
      if(programController.earlyStop)
        break;
      
      // value.isBannedUser and others are null if analysis is not enabled
      let res = await relationHandler.performAction(banMode, 
                                                    value.authorId, 
                                                    (!value.isBannedUser && !config.enableMute), 
                                                    (!value.isBannedTitle && config.enableTitleBan), 
                                                    (!value.isBannedMute && config.enableMute));
      
      if(res.resultType == enums.ResultType.FAIL)
      {
        // performAction failed because to too many request

        // while waiting cooldown, send periodic notifications to user 
        // this also provides that chrome doesn't kill the extension for being idle
        await new Promise(async resolve => 
        {
          // wait 1 minute (+2 sec to ensure)
          let waitTimeInSec = 62;
          for(let j = 1; j <= waitTimeInSec; j++)
          {
            if(programController.earlyStop)
              break;
            
            // send message to notification page
            notificationHandler.notifyCooldown(waitTimeInSec-j);
            
            // wait 1 sec
            await new Promise(resolve2 => { setTimeout(resolve2, 1000); }); 
          }
            
          resolve();        
        }); 
        
        if(!programController.earlyStop)
        {
          // value.isBannedUser and others are null if analysis is not enabled
          res = await relationHandler.performAction(banMode, 
                                                    value.authorId, 
                                                    (!value.isBannedUser && !config.enableMute),
                                                    (!value.isBannedTitle && config.enableTitleBan), 
                                                    (!value.isBannedMute && config.enableMute));
        }
      }
      
      // send message to notification page
      notificationHandler.notifyOngoing(res.successfulAction, res.performedAction, authorIdList.length);
    }
  }
  
  let successfulAction = relationHandler.successfulAction;
  let performedAction = relationHandler.performedAction;
  
  let eksi_engel_user = createEksiSozlukUser(clientName, clientId);
  let fav_author = createEksiSozlukUser(entryMetaData.authorName, entryMetaData.authorId);
  let fav_title = createEksiSozlukTitle(entryMetaData.titleName, entryMetaData.titleId);
  let fav_entry = createEksiSozlukEntry(fav_title /* TODO */, entryMetaData.entryId);

  // TODO: extremely inefficient solution, delete authorNameList and authorId arrays
  let author_list = authorIdList.map((id, index) => {
    return {
      eksisozluk_id: id,
      eksisozluk_name: authorNameList[index]
    }
  });
  // filter id==0 authors (these authors only come with BanSource::LIST)
  author_list = author_list.filter(function(item){
    const {eksisozluk_id, eksisozluk_name} = item;
    return eksisozluk_id != 0;  
  });

  let action = new Action({
    eksi_engel_user:  eksi_engel_user,
    version:          chrome.runtime.getManifest().version,
    user_agent:       userAgent,
    ban_source:       banSource,
    ban_mode:         banMode,
    author_list:      author_list,
    author_list_size: author_list.length,
    planned_action:   authorNameList.length,
    performed_action: performedAction,
    successful_action:successfulAction,
    is_early_stopped: programController.earlyStop,
    log_level:        null,
    log:              null,
    target_type:      targetType,
    click_source:     clickSource,
    fav_title:        fav_title,
    fav_entry:        fav_entry,
    fav_author:       fav_author,
    time_specifier:   timeSpecifier
  });

  // log_level and log
  if(config.sendLog && log.isEnabled)
  {
    action.log_level = log.level;
    action.log = log.getData().toString();
  }
  else
  {
    action.log_level = log.constructor.Levels.DISABLED; 
    action.log = null;
  }

  let action_config = new ActionConfig({
    eksi_sozluk_url: config.EksiSozlukURL,
    send_data: config.sendData,
    enable_noob_ban: config.enableNoobBan,
    enable_mute: config.enableTitleBan,
    enable_anaylsis_before_operations: config.enableAnalysisBeforeOperation,
    enable_only_required_actions: config.enableOnlyRequiredActions,
    enable_protect_followed_users: config.enableProtectFollowedUsers,
    ban_premium_icons: config.banPremiumIcons
  });

  if(config.sendData)
    await commHandler.sendData(action, action_config);

  notificationHandler.finishSuccess(banSource, banMode, successfulAction, performedAction, authorNameList.length);
  
  // if early stop was generated, erase planned processes in notification page
  if(programController.earlyStop)
  {
    log.info("bg", "(updatePlannedProcessesList just before finished) notification page's queue will be updated.");
    notificationHandler.updatePlannedProcessesList(""); // erase the processes in the planned processes table
    // add the remaining processes to completed process table
    let remainingProcessesArray = processQueue.itemAttributes;
    for (const element of remainingProcessesArray)
      notificationHandler.finishErrorEarlyStop(element.banSource, element.banMode);
    processQueue.clear(); // clear the remaining planned processes in the queue 
  }
  
  log.info("bg", "Program has been finished (successfull:" + successfulAction + ", performed:" + performedAction + ", planned:" + authorNameList.length + ")");

  programController.earlyStop = false; // reset to reuse
  log.resetData();
}

// this listener fired every time when the extension installed or updated.
chrome.runtime.onInstalled.addListener(async (details) => 
{
  
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL || 
      details.reason === chrome.runtime.OnInstalledReason.UPDATE) 
  {
    // first install or extension is updated
    log.info("bg", "program installed or updated.");
    
    // erase local storage, because config file could have been changed in the new version.
    await chrome.storage.local.clear();
    
    // handle config of the extension
    await handleConfig();
    
    // analytics
    await commHandler.sendAnalyticsData({click_type:enums.ClickType.INSTALL_OR_UPDATE});
    
    // open welcome page
    let tab = await chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/welcome.html") });
  }
});
