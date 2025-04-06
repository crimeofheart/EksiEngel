# Summary of Changes to Fix Button Loading Issue

## Problem Description

The Ekşi Engel extension buttons (added to entry menus, title menus, and profile pages) were not appearing reliably when navigating Ekşi Sözlük.
- **Initial Load:** Buttons sometimes required a manual page refresh to appear after the initial page load.
- **Dynamic Navigation:** Buttons often failed to appear on content loaded dynamically (e.g., by clicking sidebar links or entry links that update the page without a full reload).

## Solution Steps

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
    *   **Expected Result:** This approach robustly handles elements present on initial load and those added dynamically later, regardless of the specific container they are added to, ensuring buttons appear consistently.

This final refactoring provides a more resilient solution for handling the dynamic nature of the Ekşi Sözlük website.