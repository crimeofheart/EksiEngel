import * as enums from './enums.js';
import {commHandler} from './commHandler.js';

console.log("popup.js: has been started.");

commHandler.sendAnalyticsData({click_type:enums.ClickType.EXTENSION_ICON});

openauthorListPage.onclick = function(element) {
  commHandler.sendAnalyticsData({click_type:enums.ClickType.EXTENSION_MENU_BAN_LIST});
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/authorListPage.html") }, function (){
  // automatically close the popup.html if operation is successful
    window.close();
  });
};

startUndobanAll.onclick = function(element) {
  commHandler.sendAnalyticsData({click_type:enums.ClickType.EXTENSION_MENU_UNDOBANALL});
	// send message to background page
	chrome.runtime.sendMessage(null, {"banSource":enums.BanSource.UNDOBANALL, "banMode":enums.BanMode.UNDOBAN});
};

openFaq.onclick = function(element) {
  commHandler.sendAnalyticsData({click_type:enums.ClickType.EXTENSION_MENU_FAQ});
  chrome.tabs.create({ url: chrome.runtime.getURL("assets/html/faq.html") });
};

migrateBlockedToMuted.onclick = function(element) {
  commHandler.sendAnalyticsData({click_type:enums.ClickType.EXTENSION_MENU_MIGRATE});
  
  // Add confirmation dialog
  if (confirm("Bu işlem tüm engellenmiş kullanıcıları sessize alacak. Devam etmek istiyor musunuz?")) {
    // Send message to background page to start the migration
    chrome.runtime.sendMessage(null, {action: "startMigration"}, function(response) {
      if (chrome.runtime.lastError) {
        console.error("popup.js: Error sending startMigration message:", chrome.runtime.lastError.message);
        alert("Could not start migration process. Error: " + chrome.runtime.lastError.message);
      } else {
        console.log("popup.js: Migration start message sent.");
        alert("İşlem başlatıldı. Lütfen tarayıcı konsolunu kontrol edin.");
        window.close(); // Close popup after initiating
      }
    });
  }
};