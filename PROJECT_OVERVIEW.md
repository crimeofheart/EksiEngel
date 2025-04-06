# Ekşi Engel Project Overview

## Summary

The project "Ekşi Engel" is a Chrome browser extension designed to facilitate mass blocking/unblocking of users on Ekşi Sözlük. It provides various blocking options including blocking individual users, their titles, users who favorited specific entries, and followers of specific users.

*   **Frontend (Browser Extension):**
    *   **UI:** A popup (`popup.html`/`.js`) provides the main extension menu and triggers actions.
    *   **Integration:** A content script (`script.js`) injects buttons and menus directly into Ekşi Sözlük pages (entries, profiles, titles) and sends user actions to the background.
    *   **Dynamic Content Handling:** Uses a unified MutationObserver approach to reliably detect and modify dynamically loaded content.
    *   **Core Logic:** The background script (`background.js`) acts as the central orchestrator. It receives actions, manages a queue (`queue.js`), handles rate limiting, interacts with Ekşi Sözlük pages via scraping (`scrapingHandler.js`) and direct actions (`relationHandler.js`), checks site accessibility (`urlHandler.js`), manages configuration (`config.js`), provides user feedback via a dedicated notification page (`notificationHandler.js`), and controls the overall process (`programController.js`).
    *   **Communication:** A `commHandler.js` module is used for messaging between components and sending data to the backend.
    *   **Configuration:** Supports various user settings including title blocking, mute functionality, and analysis options.

*   **Backend (Django Server):**
    *   **Action API (`/api/`):** Receives detailed logs about *blocking/unblocking actions* performed by the extension (`/action/`). It aggregates this data to provide statistics like the most blocked users, total actions, failed actions, etc. It also provides the current Ekşi Sözlük URL (`/where_is_eksisozluk/`).
    *   **Client Data Collector (`/client_data_collector/`):** Receives general *client-side analytics* data, such as UI clicks (`/analytics`), and potentially other client data uploads (`/upload_v2`).

## Key Features

* **User Blocking:** Block individual users from entries, profiles, or lists
* **Title Blocking:** Block all titles created by specific users
* **Mass Blocking:** Block all users who favorited an entry or follow a specific user
* **Configurable Options:** Enable/disable title blocking, mute functionality, and more
* **Dynamic UI Integration:** Adds buttons to entry menus, title menus, and profile pages
* **Robust Content Detection:** Uses MutationObserver to handle dynamically loaded content
* **Analytics:** Optional data collection for usage statistics and improvement

## Architecture Diagram

```mermaid
graph LR
    subgraph "Browser Extension"
        PopupUI[popup.html + popup.js] --> BackgroundJS[background.js]
        
        subgraph "Content Script"
            MutationObserver[MutationObserver] --> DOM[DOM Changes]
            DOM --> Processors[Processing Functions]
            Processors --> EksiSozluk[Ekşi Sözlük Page]
            Processors --> ContentScript[script.js]
        end
        
        ContentScript --> BackgroundJS
        BackgroundJS --> ActionQueue[queue.js]
        ActionQueue --> ProcessHandler[background.js#processHandler]
        
        subgraph "Background Processing"
            ProcessHandler --> Scraping[scrapingHandler.js]
            ProcessHandler --> Relation[relationHandler.js]
            ProcessHandler --> Config[config.js]
            ProcessHandler --> Notify[notificationHandler.js]
            ProcessHandler --> Comm[commHandler.js]
        end
        
        Scraping --> EksiSozluk
        Relation --> EksiSozluk
        Notify --> NotificationPage[notification.html]
        Comm --> ActionAPI
        Comm --> ClientDataCollectorAPI
        PopupUI --> BackgroundJS
        PopupUI --> AuthorList[authorListPage.html]
        PopupUI --> FAQ[faq.html]
        
        Config --> Processors
    end

    subgraph "Server Backend"
        ActionAPI[/api/] --> Database[(Database)]
        ClientDataCollectorAPI[/client_data_collector/] --> Database
        ActionAPI --> WebInterface[Stats Pages]
    end

    User --> PopupUI
    User --> EksiSozluk
    User --> NotificationPage

    classDef api fill:#f9d,stroke:#333,stroke-width:2px
    classDef collector fill:#dfd,stroke:#333,stroke-width:2px
    classDef observer fill:#9cf,stroke:#333,stroke-width:2px
    
    class ActionAPI api
    class ClientDataCollectorAPI collector
    class MutationObserver,Processors observer