import {log} from './log.js';
import * as enums from './enums.js';
import * as utils from './utils.js'
import {programController} from './programController.js';
import {config} from './config.js';

// a class to manage relations (ban/undoban users/users' titles)
class RelationHandler
{
  successfulAction;
  performedAction;
  
  async performAction(banMode, id, isTargetUser, isTargetTitle, isTargetMute)
  {
    if(id == 0)
    {
      // action failed
      this.performedAction++;
      return {resultType: enums.ResultType.SUCCESS, successfulAction: this.successfulAction, performedAction: this.performedAction};
    }

    let resUser, resTitle, resMute;
    if(isTargetUser)
    {
      // enums.TargetType.USER
      let urlUser = this.#prepareHTTPRequest(banMode, enums.TargetType.USER, id);
      resUser = await this.#performHTTPRequest(banMode, enums.TargetType.USER, id, urlUser);
    }
    if(isTargetTitle)
    {
      // enums.TargetType.TITLE
      let urlTitle = this.#prepareHTTPRequest(banMode, enums.TargetType.TITLE, id);
      resTitle = await this.#performHTTPRequest(banMode, enums.TargetType.TITLE, id, urlTitle);
    }
    if(isTargetMute)
    {
      // enums.TargetType.MUTE
      let urlMute = this.#prepareHTTPRequest(banMode, enums.TargetType.MUTE, id);
      resMute = await this.#performHTTPRequest(banMode, enums.TargetType.MUTE, id, urlMute);
    }
    
    if((isTargetUser  && resUser == enums.ResultTypeHttpReq.TOO_MANY_REQ)  || 
       (isTargetTitle && resTitle == enums.ResultTypeHttpReq.TOO_MANY_REQ) ||
       (isTargetMute  && resMute == enums.ResultTypeHttpReq.TOO_MANY_REQ)  )
    {
      // too many request has been made, don't count this action and return false
      return {resultType: enums.ResultType.FAIL, successfulAction: this.successfulAction, performedAction: this.performedAction};
    }
    else
    {
      this.performedAction++;
      if((!isTargetUser  || resUser == enums.ResultTypeHttpReq.SUCCESS)  && 
         (!isTargetTitle || resTitle == enums.ResultTypeHttpReq.SUCCESS) &&
         (!isTargetMute  || resMute == enums.ResultTypeHttpReq.SUCCESS)  )
        this.successfulAction++;
     
      return {resultType: enums.ResultType.SUCCESS, successfulAction: this.successfulAction, performedAction: this.performedAction};
    }
  }
  
  // reset the internal variables to reuse
	reset = () =>
	{
		this.successfulAction = 0;
    this.performedAction = 0;
	}
  
	#prepareHTTPRequest = (banMode, targetType, id) =>
	{
    let banModeText = "";
    if(banMode === enums.BanMode.BAN)
      banModeText = "addrelation";
    else if(banMode === enums.BanMode.UNDOBAN)
      banModeText = "removerelation";
    
    let targetTypeText = "";
    if(targetType === enums.TargetType.USER)
      targetTypeText = "m";
    else if(targetType === enums.TargetType.TITLE)
      targetTypeText = "i";
    else if(targetType == enums.TargetType.MUTE)
      targetTypeText = "u";
    
    let url = `${config.EksiSozlukURL}/userrelation/${banModeText}/${id}?r=${targetTypeText}`;
    return url;
	}
  
  #performHTTPRequest = async (banMode, targetType, id, url) =>
	{
    if(id <= 0)
      return enums.ResultTypeHttpReq.FAIL;
		let res = enums.ResultTypeHttpReq.FAIL;
    try 
    {
      let response = await fetch(url, {
        method: 'POST',
           headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest'
          },
        body: "id=" + id
      });
      if(!response.ok)
      {
        log.err("relation", "http response: " + response.status);
        if(response.status == 429)
        {
          //const responseText = await response.text();
          //log.err("relation", "url: " + url + " response: " + responseText);
          return enums.ResultTypeHttpReq.TOO_MANY_REQ;
        }
        else
        {
          // If status is not 429, yet still erroneous, then something should have gone wrong.
          // dont re-try the operation, assume it was failed.
          const responseText = await response.text();
          log.err("relation", "url: " + url + " response: " + responseText);
          return enums.ResultTypeHttpReq.FAIL; 
        }
          
        
      }
      const responseText = await response.text();
      const responseJson = JSON.parse(responseText);
      
      // for enums.BanMode.BAN result is number. Probably 0 is success, 2 is already banned
      if(banMode === enums.BanMode.BAN && typeof responseJson === "number" && (responseJson === 0 || responseJson === 2))
        res = enums.ResultTypeHttpReq.SUCCESS; 
      // for enums.BanMode.UNDOBAN result is object and it has 'result' key.
      else if(banMode === enums.BanMode.UNDOBAN && typeof responseJson === "object" && responseJson.result === true)
        res = enums.ResultTypeHttpReq.SUCCESS; 
      else
        res = enums.ResultTypeHttpReq.FAIL;
      // log.info("relation", "banMode: " + banMode + ", targetType: " + targetType + ", id: " + id + ", response text: " + responseText);
    }
    catch(err)
    {
      log.err("relation", err);
      res = enums.ResultTypeHttpReq.FAIL; 
    }
    return res;
	}
}

export let relationHandler = new RelationHandler();