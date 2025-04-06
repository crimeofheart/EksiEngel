# Summary of Changes to Ekşi Engel Extension

## 1. Button Loading Issue Fix

### Problem Description

The Ekşi Engel extension buttons (added to entry menus, title menus, and profile pages) were not appearing reliably when navigating Ekşi Sözlük.
- **Initial Load:** Buttons sometimes required a manual page refresh to appear after the initial page load.
- **Dynamic Navigation:** Buttons often failed to appear on content loaded dynamically (e.g., by clicking sidebar links or entry links that update the page without a full reload).

### Solution Steps

1.  **Initial Attempt (setTimeout):**
    *   Wrapped the execution of the main button-adding functions (`handleTitleMenus`, `handleEntryMenus`, `handleRelationButtons`) in `setTimeout(..., 0)`.
    *   **Result:** This fixed the issue for the initial page load but did not resolve the problem for dynamically loaded content.

2.  **Second Attempt (Targeted MutationObserver for Entries):**
    *   Refactored `handleEntryMenus` to use a persistent `MutationObserver` specifically watching the entry list container (`#entry-item-list` or `document.body`).
    *   **Result:** This improved handling for dynamically loaded entries but the issue persisted in some navigation scenarios, potentially affecting title or profile elements loaded dynamically as well.

3.  **Final Solution (Unified MutationObserver):**
    *   Refactored `frontend/app/assets/js/script.js` significantly.
    *   Created separate processing functions (`processTitleMenu`, `processEntryMenu`, `processRelationButtons`) for each type of element where buttons are added.
    *   Implemented a single, unified `MutationObserver` that watches the entire `document.body` for `childList` changes (added nodes) with `subtree: true`.
    *   When the observer detects added nodes, it checks within those nodes for any relevant, unprocessed elements (title menus, entry menus, profile button containers) and calls the corresponding processing function.
    *   Each processing function marks the element it modifies with `data-eksiengel-processed="true"` to prevent redundant processing.
    *   An initial scan is performed on script load to process elements already present before the observer starts.
    *   **Result:** This approach robustly handles elements present on initial load and those added dynamically later, regardless of the specific container they are added to, ensuring buttons appear consistently.

## 2. Entry Menu Button Fixes (2025-06-04)

### Problem Description

Extension buttons were not appearing in the three-dot dropdown menu below 'mesaj gönder', 'şikayet', 'modlog', and 'engelle' buttons.

### Solution Steps

1.  **Selector Refinement:**
    *   Updated selectors to target the correct dropdown menus using standard CSS selectors.
    *   Added validation to ensure only the right menus are modified.
    *   **Result:** Buttons now appear in the correct dropdown menus.

2.  **Browser Compatibility Fix:**
    *   Replaced unsupported pseudo-selectors (`:has()`, `:contains()`) with standard CSS selectors.
    *   Added menu content validation to ensure we're targeting the right elements.
    *   **Result:** Fixed SyntaxError and ensured compatibility across all browsers.

3.  **Button Placement Improvement:**
    *   Enhanced button insertion logic to place buttons after existing action buttons.
    *   Added proper styling to match the existing dropdown menu items.
    *   **Result:** Buttons now appear in the expected position with consistent styling.

## 3. Title Ban Enhancement (2025-06-04)

### Feature Description

Enhanced the 'yazarı engelle' button to also block titles when the "Başlıklarını da engelle." setting is enabled.

### Implementation Details

1.  **Config-Aware Behavior:**
    *   Modified the click event handler to check the `enableTitleBan` config setting.
    *   When enabled, the button now performs two actions: blocks the user and blocks their titles.
    *   Added a small delay between requests to ensure both actions are processed correctly.
    *   **Result:** Users can now block both a user and their titles with a single click when the setting is enabled.

These changes significantly improve the extension's reliability, browser compatibility, and user experience.