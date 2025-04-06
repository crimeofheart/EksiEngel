# Ekşi Engel Project Overview

## Summary

The project "Ekşi Engel" is a Chrome browser extension designed to facilitate mass blocking/unblocking of users on Ekşi Sözlük.

*   **Frontend (Browser Extension):**
    *   **UI:** A popup (`popup.html`/`.js`) provides the main extension menu and triggers actions.
    *   **Integration:** A content script (`script.js`) injects buttons and menus directly into Ekşi Sözlük pages (entries, profiles, titles) and sends user actions to the background.
    *   **Core Logic:** The background script (`background.js`) acts as the central orchestrator. It receives actions, manages a queue (`queue.js`), handles rate limiting, interacts with Ekşi Sözlük pages via scraping (`scrapingHandler.js`) and direct actions (`relationHandler.js`), checks site accessibility (`urlHandler.js`), manages configuration (`config.js`), provides user feedback via a dedicated notification page (`notificationHandler.js`), and controls the overall process (`programController.js`).
    *   **Communication:** A `commHandler.js` module is used for messaging between components and sending data to the backend.

*   **Backend (Django Server):**
    *   **Action API (`/api/`):** Receives detailed logs about *blocking/unblocking actions* performed by the extension (`/action/`). It aggregates this data to provide statistics like the most blocked users, total actions, failed actions, etc. It also provides the current Ekşi Sözlük URL (`/where_is_eksisozluk/`).
    *   **Client Data Collector (`/client_data_collector/`):** Receives general *client-side analytics* data, such as UI clicks (`/analytics`), and potentially other client data uploads (`/upload_v2`).

## Architecture Diagram

```mermaid
graph LR
    subgraph Browser Extension (Frontend - Chrome)
        PopupUI[popup.html + popup.js] -- User Action --> BackgroundJS[background.js];
        ContentScript[script.js] -- Injects UI/Scrapes Data --> EksiSozluk[Ekşi Sözlük Page];
        ContentScript -- Sends User Action --> BackgroundJS;
        BackgroundJS -- Manages Queue --> ActionQueue[queue.js];
        ActionQueue -- Dequeues Task --> ProcessHandler[background.js#processHandler];
        ProcessHandler -- Uses --> Scraping[scrapingHandler.js];
        ProcessHandler -- Uses --> Relation[relationHandler.js];
        ProcessHandler -- Uses --> Config[config.js];
        ProcessHandler -- Uses --> Notify[notificationHandler.js];
        ProcessHandler -- Uses --> Comm[commHandler.js];
        Scraping -- Reads --> EksiSozluk;
        Relation -- Performs Action --> EksiSozluk;
        Notify -- Updates --> NotificationPage[notification.html];
        Comm -- Sends Action Logs (Optional) --> ActionAPI;
        Comm -- Sends Analytics (Optional) --> ClientDataCollectorAPI;
        PopupUI -- Sends Analytics --> BackgroundJS;
        PopupUI -- Opens --> AuthorList[authorListPage.html];
        PopupUI -- Opens --> FAQ[faq.html];
    end

    subgraph Server (Backend - Django)
        ActionAPI[/api/] -- Stores/Retrieves --> Database[(Database)];
        ClientDataCollectorAPI[/client_data_collector/] -- Stores --> Database;
        ActionAPI -- Serves Stats --> WebInterface[Stats Pages?];
    end

    User --> PopupUI;
    User --> ContentScript;
    User --> NotificationPage;

    style ActionAPI fill:#f9d,stroke:#333,stroke-width:2px;
    style ClientDataCollectorAPI fill:#dfd,stroke:#333,stroke-width:2px;