# Plan: Display Muted User Count and Export List

This plan outlines the steps to add functionality to the EksiEngel extension to:
1. Display the total count of muted users in the popup.
2. Allow users to refresh this count by scraping their muted list from Ekşi Sözlük.
3. Store the fetched list locally.
4. Allow users to export the stored list of muted usernames as a CSV file.

## 1. Enhance `scrapingHandler.js`

*   **Keep:** Existing `#scrapeAuthorNamesFromBannedAuthorPagePartially(targetType, index)` function.
*   **Create:** New public asynchronous function `scrapeAllMutedUsers()`:
    *   Initializes `allMutedUsernames = []` and `totalCount = 0`.
    *   Loops, calling `#scrapeAuthorNamesFromBannedAuthorPagePartially(enums.TargetType.MUTE, index)` starting with `index = 1`.
    *   **Inside loop:**
        *   Appends fetched `authorNameList` to `allMutedUsernames`.
        *   Adds length of fetched `authorIdList` to `totalCount`.
        *   Handles 429 (Too Many Requests) errors with waiting (60+ seconds) and retries. Notify user via notification system if delays occur.
        *   Continues looping as long as `isLast` is `false`.
        *   Includes a polite delay (e.g., 500ms) between page requests.
    *   **Returns:**
        *   On success: `{ success: true, count: totalCount, usernames: allMutedUsernames }`.
        *   On failure: `{ success: false, error: errorMessage }`.

## 2. Add Storage Capabilities (e.g., new `storageHandler.js`)

*   Create functions using `chrome.storage.local`:
    *   `saveMutedUserList(usernamesArray)`: Saves the array. Returns a promise.
    *   `getMutedUserList()`: Retrieves the array. Returns a promise resolving with the array or `null`.
    *   `getMutedUserCountFromStorage()`: Calls `getMutedUserList()` and returns the length. Returns a promise resolving with the count.

## 3. Update Popup UI (`frontend/app/assets/html/popup.html`)

*   **Add Count Display:**
    ```html
    <div id="mutedInfo" style="text-align: center; margin-top: 10px;">
      Muted Users: <span id="mutedUserCount">Loading...</span>
    </div>
    ```
*   **Add Refresh Button:**
    ```html
    <button id="refreshMutedList" class="btn btn-secondary" style="width: 48%; float: left;">Refresh Muted List</button>
    ```
*   **Add Export Button (initially disabled):**
    ```html
    <button id="exportMutedListCSV" class="btn btn-secondary" style="width: 48%; float: right;" disabled>Export List (CSV)</button>
    ```
*   **Add Status Area:** (Optional, below buttons) for messages like "Refreshing...", "List updated.", etc.

## 4. Update Popup Logic (`frontend/app/assets/js/popup.js`)

*   **Import:** `scrapingHandler`, `storageHandler`.
*   **`initializePopup()`:**
    *   Get UI element references.
    *   Call `storageHandler.getMutedUserCountFromStorage()`.
    *   Update count display and enable/disable export button based on stored count.
*   **Event Listener for `#refreshMutedList` Click:**
    *   Disable buttons, show "Refreshing..." status.
    *   Call `scrapingHandler.scrapeAllMutedUsers()`.
    *   **On Success:**
        *   Call `storageHandler.saveMutedUserList(result.usernames)`.
        *   Update count display.
        *   Enable export button if count > 0.
        *   Show "List updated." status.
        *   Re-enable refresh button.
    *   **On Failure:**
        *   Show error status.
        *   Re-enable refresh button.
*   **Event Listener for `#exportMutedListCSV` Click:**
    *   Call `storageHandler.getMutedUserList()`.
    *   **If list exists:**
        *   Generate CSV content string.
        *   Create Blob and download link.
        *   Trigger download.
        *   Show "List exported." status.
    *   **If no list:** Show error status.

## Conceptual Flow Diagram

```mermaid
graph TD
    subgraph Popup UI (popup.html)
        A[Count Display Span (#mutedUserCount)]
        B[Refresh Button (#refreshMutedList)]
        C[Export Button (#exportMutedListCSV)]
        C_State{Export Enabled?};
        D[Status Message Area]
    end

    subgraph Popup Logic (popup.js)
        E[Initialize] --> F{Get Count from Storage};
        F -- Count --> G[Update Count Display];
        G --> A;
        F -- Count > 0 --> H[Enable Export Button];
        F -- Count <= 0 --> I[Disable Export Button];
        H --> C_State; I --> C_State; C_State --> C;

        B -- Click --> J{Disable Buttons};
        J --> K[Show Refreshing Status]; K --> D;
        K --> L{Call scrapeAllMutedUsers};

        L -- Success --> M{Save List to Storage};
        M --> N[Update Count Display]; N --> A;
        N --> O{Enable Export Button}; O --> C_State;
        O --> P[Show Success Status]; P --> D;
        P --> Q{Enable Refresh Button}; Q --> B;

        L -- Failure --> R[Show Error Status]; R --> D;
        R --> Q;


        C -- Click --> S{Get List from Storage};
        S -- List Found --> T{Generate CSV Blob};
        T --> U{Create &amp; Click Download Link};
        U --> V[Show Exported Status]; V --> D;
        S -- No List --> W[Show Error Status]; W --> D;
    end

    subgraph Scraping (scrapingHandler.js)
        X[scrapeAllMutedUsers()] --> Y{Loop: scrapePartialMutedPage};
        Y --> Z{Accumulate Count &amp; Usernames};
        Z --> AA{Handle Rate Limits/Delays};
        AA --> Y;
        X -- Returns {success, count, usernames} / {success, error} --> L;
    end

    subgraph Storage (storageHandler.js)
        BB[saveMutedUserList()]
        CC[getMutedUserList()]
        DD[getMutedUserCountFromStorage()]

        F --> DD;
        M --> BB;
        S --> CC;
    end

    style AA fill:#f9f,stroke:#333,stroke-width:1px