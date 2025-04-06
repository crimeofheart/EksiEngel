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

  setTimeout(async () => {
    try {
      // select the search menu in a title page
      let htmlElementSearchMenu = await waitForElm("#in-topic-search-options", "title menu");
      
      // create new buttons
      let li1 = document.createElement("li");
      let li2 = document.createElement("li");
      li1.innerHTML = `<a><img src=${eksiEngelIconURL}> başlıktakileri engelle (son 24 saatte)</a>`;
      li2.innerHTML = `<a><img src=${eksiEngelIconURL}> başlıktakileri engelle (tümü)</a>`;
      
      // append the created buttons to before last element in entry page menu (search menu)
      htmlElementSearchMenu[0].insertBefore(li1, htmlElementSearchMenu[0].children[htmlElementSearchMenu[0].childElementCount-1]);
      htmlElementSearchMenu[0].insertBefore(li2, htmlElementSearchMenu[0].children[htmlElementSearchMenu[0].childElementCount-1]);
      
      // get title name and id
      let titleName = document.querySelector("#title").getAttribute("data-slug");
      let titleId = document.querySelector("#title").getAttribute("data-id");
      
      // add listener to appended button
      li1.addEventListener("click", function(){
        // last 24 hours
        EksiEngel_sendMessage(enums.BanSource.TITLE, enums.BanMode.BAN, null, null, null, null, enums.ClickSource.TITLE, titleName, titleId, enums.TimeSpecifier.LAST_24_H);
      });
      li2.addEventListener("click", function(){
        // all time
        EksiEngel_sendMessage(enums.BanSource.TITLE, enums.BanMode.BAN, null, null, null, null, enums.ClickSource.TITLE, titleName, titleId, enums.TimeSpecifier.ALL);
      });
    } catch (error) {
      console.error("Eksi Engel: Error in handleTitleMenus:", error);
    }
  }, 0);

  setTimeout(async () => {
    try {
      // find source of the page to determine clickSource
      let clickSource = enums.ClickSource.ENTRY;
      // target url: https://website.com/sorunsal/example-title
      let page = window.location.pathname.split('/')[1];
      if(page == "sorunsal")
        clickSource = enums.ClickSource.QUESTION;
          
      // select all dropdown menus for each entry in the page
      let entryMenus = await waitForElm(".other.dropdown .dropdown-menu.right.toggles-menu", "entry menu");

      // select all meta tags for each entry in the page
      let entryMetas = await waitForElm("[data-author-id]", "meta in entry");

      let eksiSozlukURL = window.location.origin;

      for (let i = 0; i < entryMenus.length; i++)
      {
        let entryMenu = entryMenus[i];
        let entryMeta = entryMetas[i];
        
        // extract some info from meta tag
        let authorName = entryMeta.getAttribute("data-author");
        let authorId = entryMeta.getAttribute("data-author-id");
        let entryId = entryMeta.getAttribute("data-id");
        let entryUrl = `${eksiSozlukURL}/entry/${entryId}`;
        
        // replace every whitespace with - (ekşi naming convention)
        authorName = authorName.replace(/ /gi, "-");

        // create new buttons ('a' tag is for css reasons)
        let newButtonBanUser = document.createElement("li");
        newButtonBanUser.innerHTML = `<a><img src=${eksiEngelIconURL}> yazarı engelle</a>`;
        let newButtonBanFav = document.createElement("li");
        newButtonBanFav.innerHTML = `<a><img src=${eksiEngelIconURL}> favlayanları engelle</a>`;
        let newButtonBanFollow = document.createElement("li");
        newButtonBanFollow.innerHTML = `<a><img src=${eksiEngelIconURL}> takipçilerini engelle</a>`;
        
        // append new buttons
        entryMenu.style.minWidth = "max-content"; // allocate enough space for long texts
        entryMenu.appendChild(newButtonBanUser);
        entryMenu.appendChild(newButtonBanFav);
        entryMenu.appendChild(newButtonBanFollow);
        
        // add listeners to appended buttons
        newButtonBanUser.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, entryUrl, authorName, authorId, enums.TargetType.USER, clickSource) });
        newButtonBanFav.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FAV, enums.BanMode.BAN, entryUrl, authorName, authorId, null, clickSource) });
        newButtonBanFollow.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FOLLOW, enums.BanMode.BAN, entryUrl, authorName, authorId, null, clickSource) });
      }

      //console.log("Eksi Engel: handleEntryMenus: done");
    } catch (error) {
      console.error("Eksi Engel: Error in handleEntryMenus:", error);
    }
  }, 0);

  setTimeout(async () => {
    try {
      // target url: https://website.com/biri/example-user
      let page = window.location.pathname.split('/')[1];
      if(page != "biri")
        return
      // TODO: handleRelationButtons should be implemented in these pages as well
      // dont forget click source while working this todo
      // TODO amendment: it seems no more ban/undo ban button is exist in takip and takipçi pages. but i cannot remember
      //if(page == "takip" || page == "takipci" )
      //  return;

      try
      {
        // css fix
        document.querySelectorAll(".profile-buttons .dropdown-menu")[1].style.width = '210px';
      }
      catch(e)
      {
        // dont do anything
      }

      let buttonsRelation = await waitForElm(".relation-link", "author menu");

      let authorName = document.querySelector("[data-nick]").getAttribute("data-nick");
      let authorId = String(document.getElementById("who").value); // String is in case

      let buttonRelationTitleBan; // TODO fix this mess

      for (let i = 0; i < buttonsRelation.length; i++)
      {
        let buttonRelation = buttonsRelation[i];
        let nameOfTheButton = buttonRelation.getAttribute("data-add-caption");
        let idOfTheButton = buttonRelation.id;
        let isBanned = buttonRelation.getAttribute("data-added");
        
        // inject new buttons instead of old ones ('span' tag is for css reasons)
        if(nameOfTheButton == "engelle")
        {
          if(idOfTheButton == "button-blocked-link")
          {
            // remove big red button (dropdown menu is enough)
            buttonRelation.remove();
          }
          else
          {
            
            let newButton = document.createElement("li");
            if(isBanned == "true")
            {
              newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> engellemeyi bırak</span></a>`;
              newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.USER, enums.ClickSource.PROFILE) });
            }
            else
            {
              newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> engelle</span></a>`;
              newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.USER, enums.ClickSource.PROFILE) });
            }
            buttonRelation.parentNode.parentNode.append(newButton);
            
          }
        
        }
        else if(nameOfTheButton == "başlıklarını engelle")
        {
          let newButton = document.createElement("li");
          if(isBanned == "true")
          {
            newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> başlıkları engellemeyi kaldır</span></a>`;
            newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.TITLE, enums.ClickSource.PROFILE) });
          }
          else
          {
            newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> başlıklarını engelle</span></a>`;
            newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.TITLE, enums.ClickSource.PROFILE) });
          }
          buttonRelation.parentNode.parentNode.append(newButton);
          
          buttonRelationTitleBan = buttonRelation; // TODO: fix this mess
          
        }
        else if(nameOfTheButton == "sessize al")
        {
          let newButton = document.createElement("li");
          if(isBanned == "true")
          {
            newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> sessizden çıkar</span></a>`;
            newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.UNDOBAN, null, authorName, authorId, enums.TargetType.MUTE, enums.ClickSource.PROFILE) });
          }
            
          else
          {
            newButton.innerHTML = `<a><span><img src=${eksiEngelIconURL}> sessize al</span></a>`;
            newButton.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.SINGLE, enums.BanMode.BAN, null, authorName, authorId, enums.TargetType.MUTE, enums.ClickSource.PROFILE) });
          }
            
          buttonRelation.parentNode.parentNode.append(newButton);
        }
        
      }

      // TODO: fix later, find better place to do it
      // add 'follow ban' button
      if (buttonRelationTitleBan) { // Ensure buttonRelationTitleBan exists before appending
        let newButtonFollow = document.createElement("li");
        newButtonFollow.innerHTML = `<a><span><img src=${eksiEngelIconURL}> takipçilerini engelle</span></a>`;
        newButtonFollow.addEventListener("click", function(){ EksiEngel_sendMessage(enums.BanSource.FOLLOW, enums.BanMode.BAN, null, authorName, authorId, null, enums.ClickSource.PROFILE) });
        buttonRelationTitleBan.parentNode.parentNode.append(newButtonFollow);
      }


      //console.log("Eksi Engel: handleRelationButtons: done");
    } catch (error) {
      console.error("Eksi Engel: Error in handleRelationButtons:", error);
    }
  }, 0);

})();