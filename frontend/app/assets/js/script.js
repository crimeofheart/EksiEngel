(async () => {
  let eksiEngelIconURL = chrome.runtime.getURL('assets/img/eksiengel16.png');
  const src = chrome.runtime.getURL("assets/js/enums.js");
  const enums = await import(src);

  async function getConfig()
  {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get("config", function(items){
        if(!chrome.runtime.error)
        {
          if(items != undefined && items.config != undefined && Object.keys(items.config).length !== 0)
          {
            resolve(items.config);  
          }
          else 
          {
            resolve(false);
          }
        }
        else 
        {
          resolve(false);
        }
      }); 
    });
  }

  let EksiEngel_sendMessage = (banSource, banMode, entryUrl, authorName, authorId, targetType, clickSource, titleName, titleId, timeSpecifier) =>
  {
    chrome.runtime.sendMessage(
      null, 
      {
        banSource:banSource, 
        banMode:banMode,
        entryUrl:entryUrl,
        authorName:authorName,
        authorId:authorId,
        targetType:targetType,
        clickSource:clickSource,
        titleName: titleName,
        titleId: titleId,
        timeSpecifier: timeSpecifier
      }, 
      function(response) 
      {
        let lastError = chrome.runtime.lastError;
        if(lastError)
        {
          //console.log("Eksi Engel: could not establish a connection with a page");
        }
        else
        {
          //console.log("Eksi Engel: established a connection with a page");
          
          // notify the user about their action with using eksisozluk notification API, known classes: class="success" and class="error"
          let ul = document.createElement("ul"); 
          ul.innerHTML = `<ul><li class="success" style=""><img src=${eksiEngelIconURL}> Ekşi Engel, istediğiniz işlemi sıraya ekledi.<a class="close">×</a></li></ul>`;
          document.getElementById('user-notifications').appendChild(ul);
        
          // close the notifications after a while automatically
          setTimeout(() => ul.remove(), 3000);
        }
      }
    );
  }

  function waitForElm(selector, debugComment) 
  {
    return new Promise(resolve => 
    {
      if (document.querySelectorAll(selector).length) 
      {
        //console.log("Eksi Engel: observation stopped immediately for: " + debugComment);
        return resolve(document.querySelectorAll(selector));
      }

      //console.log("Eksi Engel: observation started for: " + debugComment);
      
      const observer = new MutationObserver(mutations => 
      {
        if (document.querySelectorAll(selector).length) 
        {
          //console.log("Eksi Engel: observation stopped for: " + debugComment);
          resolve(document.querySelectorAll(selector));
          observer.disconnect();
        }
      });

      observer.observe(
        document.body, 
        {
          childList: true,
          subtree: true
        }
      );
    });
  }

  async function handleYellowIcons (config) {

    // info: source code has invalid html because there are multiple components that have the same ID
    // <div id="subscriber-badge-entry">
    //   <svg class="eksico subscriber-badge" id="svg-subscriber-badge">
    //     <use xlink:href="#eksico-status-badge"></use>
    //   </svg>
    // </div>

    // select all icons in the page
    let icons = await waitForElm(".eksico.subscriber-badge", "yellow icons");
    
    for (let i = 0; i < icons.length; i++) 
    {
      try 
      {
        let parentNode = icons[i].parentNode;
        if(parentNode.id === "subscriber-badge-entry")
          parentNode.style.display = "none";
      }
      catch (err)
      {
        //console.log("Eksi Engel: handleYellowIcons: " + err);
      }
    }

    //console.log("Eksi Engel: handleYellowIcons: done");
  }

  async function handleGreenIcons (config) {

    // info: source code has invalid html because there are multiple components that have the same ID
    // <div id="verified-badge-entry">
    //   <svg class="eksico verified-badge" id="svg-verified-badge">
    //     <use xlink:href="#eksico-status-badge"></use>
    //   </svg>
    // </div>

    // select all icons in the page
    let icons = await waitForElm(".eksico.verified-badge", "green icons");
    
    for (let i = 0; i < icons.length; i++) 
    {
      try 
      {
        let parentNode = icons[i].parentNode;
        if(parentNode.id === "verified-badge-entry")
          parentNode.style.display = "none";
      }
      catch (err)
      {
        //console.log("Eksi Engel: handleGreenIcons: " + err);
      }
    }

    //console.log("Eksi Engel: handleGreenIcons: done");
  }

  (async function handleIcons () {
    const config = await getConfig();
    if(config && config.banPremiumIcons)
    {
      handleYellowIcons(config); // without await
      handleGreenIcons(config); // without await
    }
    else
    {
      // config could not be read maybe not exist, do nothing
      return;
    }
  })();

  // --- Refactored Handlers with MutationObserver ---

  const processedMark = 'eksiengel-processed'; // Attribute to mark processed elements

  // Function to process a single Title Menu (#in-topic-search-options)
  const processTitleMenu = (menuElement) => {
    if (menuElement.dataset[processedMark]) return; // Already processed

    try {
      // Check if the necessary child elements exist before proceeding
      if (menuElement.children.length === 0) return;

      // create new buttons
      let li1 = document.createElement("li");
      let li2 = document.createElement("li");
      li1.innerHTML = `<a><img src=${eksiEngelIconURL}> başlıktakileri engelle (son 24 saatte)</a>`;
      li2.innerHTML = `<a><img src=${eksiEngelIconURL}> başlıktakileri engelle (tümü)</a>`;

      // append the created buttons to before last element
      menuElement.insertBefore(li1, menuElement.children[menuElement.childElementCount-1]);
      menuElement.insertBefore(li2, menuElement.children[menuElement.childElementCount-1]);

      // get title name and id (assuming #title is available when the menu is)
      let titleElement = document.querySelector("#title");
      if (!titleElement) {
          console.error("Eksi Engel: #title element not found when processing title menu.");
          return; // Cannot get title info
      }
      let titleName = titleElement.getAttribute("data-slug");
      let titleId = titleElement.getAttribute("data-id");

      if (!titleName || !titleId) {
          console.error("Eksi Engel: Missing data attributes on #title element.");
          return; // Cannot get title info
      }

      // add listener to appended button
      li1.addEventListener("click", function(){
        EksiEngel_sendMessage(enums.BanSource.TITLE, enums.BanMode.BAN, null, null, null, null, enums.ClickSource.TITLE, titleName, titleId, enums.TimeSpecifier.LAST_24_H);
      });
      li2.addEventListener("click", function(){
        EksiEngel_sendMessage(enums.BanSource.TITLE, enums.BanMode.BAN, null, null, null, null, enums.ClickSource.TITLE, titleName, titleId, enums.TimeSpecifier.ALL);
      });

      menuElement.dataset[processedMark] = "true"; // Mark as processed
      //console.log("Eksi Engel: Processed title menu.");

    } catch (error) {
      console.error("Eksi Engel: Error processing title menu:", error, menuElement);
      // Mark as processed even if error occurs to prevent retrying on the same broken element
      menuElement.dataset[processedMark] = "true";
    }
  };

  // Function to add buttons to a single entry menu
  // Function to process a single Entry Menu
  const processEntryMenu = (entryMenu) => {
    if (entryMenu.dataset[processedMark]) return; // Already processed

    try {
      // Find the corresponding entry meta data container (usually the parent entry element)
      const entryElement = entryMenu.closest('li[data-id]'); // Adjust selector if needed
      if (!entryElement) {
        // console.error("Eksi Engel: Could not find parent entry element for menu.", entryMenu);
        return; // Cannot find parent, skip
      }

      // Extract info from the entry element itself
      const authorName = entryElement.getAttribute("data-author")?.replace(/ /gi, "-");
      const authorId = entryElement.getAttribute("data-author-id");
      const entryId = entryElement.getAttribute("data-id");
      const eksiSozlukURL = window.location.origin;
      const entryUrl = `${eksiSozlukURL}/entry/${entryId}`;

      if (!authorName || !authorId || !entryId) {
        // console.error("Eksi Engel: Missing data attributes on entry element.", entryElement);
        return; // Missing data, skip
      }

      // Determine click source
      let clickSource = enums.ClickSource.ENTRY;
      let page = window.location.pathname.split('/')[1];
      if (page == "sorunsal") {
        clickSource = enums.ClickSource.QUESTION;
      }

      // Create new buttons ('a' tag is for css reasons)
      let newButtonBanUser = document.createElement("li");
      newButtonBanUser.innerHTML = `<a><img src=${eksiEngelIconURL}> yazarı engelle</a>`;
      let newButtonBanFav = document.createElement("li");
      newButtonBanFav.innerHTML = `<a><img src=${eksiEngelIconURL}> favlayanları engelle</a>`;
      let newButtonBanFollow = document.createElement("li");
      newButtonBanFollow.innerHTML = `<a><img src=${eksiEngelIconURL}> takipçilerini engelle</a>`;

      // Append new buttons
      entryMenu.style.minWidth = "max-content"; // allocate enough space for long texts
      entryMenu.appendChild(newButtonBanUser);
      entryMenu.appendChild(newButtonBanFav);
      entryMenu.appendChild(newButtonBanFollow);

      // Add listeners to appended buttons
      newButtonBanUser.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, entryUrl, authorName, authorId, enums.TargetType.USER, clickSource) });
      newButtonBanFav.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FAV, enums.BanMode.BAN, entryUrl, authorName, authorId, null, clickSource) });
      newButtonBanFollow.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FOLLOW, enums.BanMode.BAN, entryUrl, authorName, authorId, null, clickSource) });

      entryMenu.dataset[processedMark] = "true"; // Mark as processed
      //console.log("Eksi Engel: Processed entry menu for entry ID:", entryId);

    } catch (error) {
      console.error("Eksi Engel: Error processing entry menu:", error, entryMenu);
      entryMenu.dataset[processedMark] = "true"; // Mark as processed even on error
    }
  };

  // Function to process Relation Buttons (on profile pages)
  const processRelationButtons = (profileButtonsContainer) => {
      // Profile pages might reload content differently. We target a container.
      // Let's assume the container is '.profile-buttons' or similar.
      // We need to re-run the logic if the *content* of this container changes significantly.
      // A simple check: has the number of direct children changed? Or use a version marker.
      const currentButtonCount = profileButtonsContainer.querySelectorAll('.relation-link').length;
      const processedButtonCount = parseInt(profileButtonsContainer.dataset.eksiengelProcessedButtons || '0');

      // If the number of relation links hasn't changed, assume it's already processed or stable.
      // This is imperfect but avoids constant reprocessing on minor style changes.
      // A more robust check might involve hashing the innerHTML or checking specific button states.
      // if (currentButtonCount === processedButtonCount && profileButtonsContainer.dataset[processedMark]) return;

      // Let's try reprocessing more aggressively for profile pages, marking the container
      if (profileButtonsContainer.dataset[processedMark]) return;


      try {
          // Check if we are actually on a profile page ('/biri/')
          let page = window.location.pathname.split('/')[1];
          if (page !== "biri") return; // Only run on profile pages

          // Attempt CSS fix (might fail if element doesn't exist yet)
          try {
              const dropdownMenu = profileButtonsContainer.querySelector(".dropdown-menu");
              if (dropdownMenu) dropdownMenu.style.width = '210px';
          } catch (e) { /* ignore */ }

          const authorNameElement = document.querySelector("[data-nick]");
          const authorIdElement = document.getElementById("who");

          if (!authorNameElement || !authorIdElement) {
              // console.error("Eksi Engel: Could not find author name/ID elements on profile page.");
              return; // Essential elements not found yet
          }
          const authorName = authorNameElement.getAttribute("data-nick");
          const authorId = String(authorIdElement.value); // String is in case

          let buttonRelationTitleBan = null; // Track the title ban button to append "block followers" after it

          // Find existing relation links within this container
          const buttonsRelation = profileButtonsContainer.querySelectorAll(".relation-link");
          if (buttonsRelation.length === 0) return; // No buttons found yet

          // Clear existing injected buttons to prevent duplicates if reprocessing
          profileButtonsContainer.querySelectorAll('.eksiengel-injected-button').forEach(btn => btn.remove());

          buttonsRelation.forEach(buttonRelation => {
              let nameOfTheButton = buttonRelation.getAttribute("data-add-caption");
              let idOfTheButton = buttonRelation.id;
              let isBanned = buttonRelation.getAttribute("data-added");
              let parentListItem = buttonRelation.closest('li'); // Find the parent <li>

              if (!parentListItem) return; // Skip if structure is unexpected

              let newButton = document.createElement("li");
              newButton.classList.add('eksiengel-injected-button'); // Mark for potential removal later

              if (nameOfTheButton == "engelle") {
                  if (idOfTheButton == "button-blocked-link") {
                      // remove big red button (dropdown menu is enough)
                      buttonRelation.remove();
                  } else {
                      if (isBanned == "true") {
                          newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> engellemeyi bırak</span></a>`;
                          newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.USER, enums.ClickSource.PROFILE) });
                      } else {
                          newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> engelle</span></a>`;
                          newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.USER, enums.ClickSource.PROFILE) });
                      }
                      parentListItem.parentNode.append(newButton);
                  }
              } else if (nameOfTheButton == "başlıklarını engelle") {
                  if (isBanned == "true") {
                      newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> başlıkları engellemeyi kaldır</span></a>`;
                      newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.TITLE, enums.ClickSource.PROFILE) });
                  } else {
                      newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> başlıklarını engelle</span></a>`;
                      newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.TITLE, enums.ClickSource.PROFILE) });
                  }
                  parentListItem.parentNode.append(newButton);
                  buttonRelationTitleBan = newButton; // Mark where to add "block followers"

              } else if (nameOfTheButton == "sessize al") {
                  if (isBanned == "true") {
                      newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> sessizden çıkar</span></a>`;
                      newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.MUTE, enums.ClickSource.PROFILE) });
                  } else {
                      newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> sessize al</span></a>`;
                      newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.MUTE, enums.ClickSource.PROFILE) });
                  }
                  parentListItem.parentNode.append(newButton);
              }
          });

          // Add 'block followers' button after the title ban button, if found
          if (buttonRelationTitleBan) {
              let newButtonFollow = document.createElement("li");
              newButtonFollow.classList.add('eksiengel-injected-button');
              newButtonFollow.innerHTML = `<a><span><img src=${eksiEngelIconURL}> takipçilerini engelle</span></a>`;
              newButtonFollow.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FOLLOW, enums.BanMode.BAN, null, authorName, authorId, null, enums.ClickSource.PROFILE) });
              buttonRelationTitleBan.parentNode.insertBefore(newButtonFollow, buttonRelationTitleBan.nextSibling); // Insert after
          }

          profileButtonsContainer.dataset[processedMark] = "true"; // Mark container as processed
          // profileButtonsContainer.dataset.eksiengelProcessedButtons = currentButtonCount; // Store count for comparison
          //console.log("Eksi Engel: Processed relation buttons.");

      } catch (error) {
          console.error("Eksi Engel: Error processing relation buttons:", error, profileButtonsContainer);
          profileButtonsContainer.dataset[processedMark] = "true"; // Mark as processed even on error
      }
  };

  // --- Main Observer ---

  const observeDOMChanges = () => {
    const observer = new MutationObserver((mutationsList) => {
      // Use requestAnimationFrame to batch processing and avoid layout thrashing
      window.requestAnimationFrame(() => {
        let processedSomething = false;
        for (const mutation of mutationsList) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                // Check for Title Menu
                if (node.matches('#in-topic-search-options')) {
                  processTitleMenu(node);
                  processedSomething = true;
                } else {
                  node.querySelectorAll('#in-topic-search-options:not([data-eksiengel-processed="true"])').forEach(processTitleMenu);
                  if (node.querySelector('#in-topic-search-options:not([data-eksiengel-processed="true"])')) processedSomething = true;
                }

                // Check for Entry Menus
                const entryMenuSelector = ".other.dropdown .dropdown-menu.right.toggles-menu";
                if (node.matches(entryMenuSelector)) {
                  processEntryMenu(node);
                   processedSomething = true;
                } else {
                  node.querySelectorAll(`${entryMenuSelector}:not([data-eksiengel-processed="true"])`).forEach(processEntryMenu);
                   if (node.querySelector(`${entryMenuSelector}:not([data-eksiengel-processed="true"])`)) processedSomething = true;
                }

                // Check for Relation Button Containers (adjust selector if needed)
                const relationContainerSelector = ".profile-buttons"; // Example selector
                 if (node.matches(relationContainerSelector)) {
                  processRelationButtons(node);
                   processedSomething = true;
                } else {
                  // Check if added node *contains* the container
                  const container = node.querySelector(`${relationContainerSelector}:not([data-eksiengel-processed="true"])`);
                  if(container) {
                      processRelationButtons(container);
                      processedSomething = true;
                  }
                  // Also check if the node *is within* a container that might need reprocessing
                  const parentContainer = node.closest(`${relationContainerSelector}`);
                  if(parentContainer && !parentContainer.dataset[processedMark]) {
                      // console.log("Reprocessing relation buttons due to child change", node);
                      // parentContainer.removeAttribute('data-eksiengel-processed'); // Allow reprocessing
                      // processRelationButtons(parentContainer);
                      // Be cautious with reprocessing containers - might cause infinite loops if not careful
                  }
                }
              }
            });
          }
          // Optional: Handle attribute changes if needed, e.g., if 'data-added' changes on relation buttons
          // else if (mutation.type === 'attributes') {
          //    if (mutation.target.matches('.relation-link') && mutation.attributeName === 'data-added') {
          //        const container = mutation.target.closest('.profile-buttons');
          //        if (container) {
          //            container.removeAttribute('data-eksiengel-processed'); // Allow reprocessing
          //            processRelationButtons(container);
          //        }
          //    }
          // }
        }
        // if (processedSomething) console.log("Eksi Engel: Processed elements after mutation.");
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // attributes: true, // Uncomment if observing attribute changes is necessary
      // attributeFilter: ['data-added'] // Example: only observe changes to 'data-added'
    });

    //console.log("Eksi Engel: Main DOM observer started.");
  };

  // --- Initial Scan and Observer Start ---

  // Perform an initial scan for elements present on load
  try {
    document.querySelectorAll('#in-topic-search-options:not([data-eksiengel-processed="true"])').forEach(processTitleMenu);
    document.querySelectorAll('.other.dropdown .dropdown-menu.right.toggles-menu:not([data-eksiengel-processed="true"])').forEach(processEntryMenu);
    document.querySelectorAll('.profile-buttons:not([data-eksiengel-processed="true"])').forEach(processRelationButtons); // Adjust selector if needed
    //console.log("Eksi Engel: Initial element scan complete.");
  } catch(error) {
      console.error("Eksi Engel: Error during initial scan:", error);
  }

  // Start observing for dynamic changes
  observeDOMChanges();

  // Note: The previous setTimeout wrappers are removed.
  // The initial scan and the main observer handle the execution now.

})();