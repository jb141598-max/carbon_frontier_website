(function(){
  "use strict";
  const AUTH_KEY="carbon-frontier-google-session-v1";
  const API=["/api/wiki-access","/.netlify/functions/wiki-access"];
  function session(){
    try{
      const stored=JSON.parse(localStorage.getItem(AUTH_KEY)||"null");
      return stored?.email&&stored?.idToken ? stored:null;
    }catch{return null}
  }
  async function requestEndpoint(url,{method="GET",body=null}={}){
    const account=session();
    const response=await fetch(url,{
      method,cache:"no-store",
      headers:{accept:"application/json",...(body?{"content-type":"application/json"}:{}),
        ...(account?.idToken?{authorization:"Bearer "+account.idToken}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok){
      const error=new Error(payload?.error||"Request failed ("+response.status+").");
      error.status=response.status;throw error;
    }
    return payload;
  }
  async function access(){
    let last;
    for(const url of API){
      try{return await requestEndpoint(url)}
      catch(error){last=error;if(error.status!==404)throw error}
    }
    throw last||new Error("Wiki access service unavailable.");
  }
  function loginHref(){
    return "/wiki/login?return="+encodeURIComponent(location.pathname+location.search+location.hash);
  }
  function showDenied(message){
    const target=document.getElementById("status");
    if(!target)return;
    target.replaceChildren();
    const p=document.createElement("p");p.textContent=message;
    const a=document.createElement("a");a.className="btn primary";a.href=loginHref();a.textContent="Log in";
    target.append(p,a);target.hidden=false;
    document.getElementById("workspace")?.setAttribute("hidden","");
  }
  window.CFWikiStaff=Object.freeze({session,access,requestEndpoint,loginHref,showDenied});
})();