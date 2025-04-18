import { log } from './log.js';

const MUTED_USER_LIST_KEY = 'mutedUserList';

class StorageHandler {

  /**
   * Saves the array of muted usernames to local storage.
   * @param {string[]} usernamesArray - The array of usernames to save.
   * @returns {Promise<void>} A promise that resolves on success, or rejects on error.
   */
  async saveMutedUserList(usernamesArray) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [MUTED_USER_LIST_KEY]: usernamesArray }, () => {
        if (chrome.runtime.lastError) {
          log.err('storage', `Error saving muted user list: ${chrome.runtime.lastError.message}`);
          reject(chrome.runtime.lastError);
        } else {
          log.info('storage', `Saved ${usernamesArray.length} muted usernames.`);
          resolve();
        }
      });
    });
  }

  /**
   * Retrieves the array of muted usernames from local storage.
   * @returns {Promise<string[] | null>} A promise resolving with the array or null if not found/error.
   */
  async getMutedUserList() {
    return new Promise((resolve) => {
      chrome.storage.local.get([MUTED_USER_LIST_KEY], (result) => {
        if (chrome.runtime.lastError) {
          log.err('storage', `Error getting muted user list: ${chrome.runtime.lastError.message}`);
          resolve(null); // Resolve with null on error
        } else {
          const list = result[MUTED_USER_LIST_KEY];
          if (Array.isArray(list)) {
            log.info('storage', `Retrieved ${list.length} muted usernames from storage.`);
            resolve(list);
          } else {
            log.info('storage', 'No muted user list found in storage.');
            resolve(null); // Resolve with null if key doesn't exist or is not an array
          }
        }
      });
    });
  }

  /**
   * Retrieves the count of muted users from local storage.
   * @returns {Promise<number>} A promise resolving with the count (0 if none stored or error).
   */
  async getMutedUserCountFromStorage() {
    try {
      const list = await this.getMutedUserList();
      return list ? list.length : 0;
    } catch (error) {
      // getMutedUserList already logs errors
      return 0;
    }
  }
}

export let storageHandler = new StorageHandler();