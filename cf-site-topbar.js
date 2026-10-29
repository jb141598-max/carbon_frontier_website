(function(){
"use strict";
const toggle=document.getElementById("cf-site-menu-toggle");
const menu=document.getElementById("cf-site-menu");
if(!toggle||!menu)return;
const item=(id)=>document.getElementById(id);
async function loadSiteAccess(token){
  let lastError=new Error("Wiki access is currently unavailable.");
  for(const endpoint of ["/api/wiki-access","/.netlify/functions/wiki-access"]){
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),9000);
    try{
      const response=await fetch(endpoint,{
        cache:"no-store",signal:controller.signal,
        headers:{authorization:"Bearer "+token,accept:"application/json"}
      });
      if(response.status===404)continue;
      if(!response.ok){
        const error=new Error("Wiki access request failed ("+response.status+").");
        error.status=response.status;throw error;
      }
      return await response.json();
    }catch(error){
      lastError=error?.name==="AbortError"
        ?new Error("Wiki access timed out. Please retry."):error;
      if(error?.status===401||error?.status===403)throw error;
    }finally{window.clearTimeout(timer);}
  }
  throw lastError;
}
function showStaffTools(viewer){
  let section=item("cf-menu-staff-tools");
  if(!section){
    section=document.createElement("div");
    section.id="cf-menu-staff-tools";
    section.className="cf-menu-staff-tools";
    for(const [label,href] of [
      ["Analytics","/wiki/analytics"],["Moderation","/wiki/moderation"],
      ["Import","/wiki/import"],["Permissions","/wiki/permissions"],
      ["Appearance","/wiki/style"]
    ]){
      const link=document.createElement("a");
      link.className="cf-menu-link";link.href=href;link.textContent=label;
      section.append(link);
    }
    menu.insertBefore(section,menu.querySelector(".cf-menu-account"));
  }
  section.hidden=!viewer?.canManageEditors;
}
function close(){
  menu.hidden=true;toggle.setAttribute("aria-expanded","false");
}
toggle.addEventListener("click",(event)=>{
  event.stopPropagation();menu.hidden=!menu.hidden;
  toggle.setAttribute("aria-expanded",String(!menu.hidden));
});
menu.addEventListener("click",(event)=>event.stopPropagation());
document.addEventListener("click",close);
document.addEventListener("keydown",(event)=>{
  if(event.key==="Escape"&&!menu.hidden){close();toggle.focus();}
});
item("cf-menu-login").href="/login?return="+encodeURIComponent(
  location.pathname+location.search+location.hash
);
const signout=item("cf-menu-signout");
if(signout) signout.addEventListener("click",()=>{
  localStorage.removeItem("carbon-frontier-google-session-v1");
  window.location.assign("/login?return="+encodeURIComponent(location.pathname+location.search));
});
const accountLabel=item("cf-menu-user");
function showAccount(viewer, account) {
  if (!accountLabel) return;
  accountLabel.hidden=!viewer?.authenticated;
  accountLabel.textContent=viewer?.authenticated
    ? "Signed in: "+String(account?.email||"Wiki account") : "";
  if(signout) signout.hidden=!viewer?.authenticated;
}
const raw=localStorage.getItem("carbon-frontier-google-session-v1");
let account=null;
try{account=JSON.parse(raw||"null")}catch{}
item("cf-menu-login").hidden=Boolean(account?.idToken);
if(!account?.idToken)return;
loadSiteAccess(account.idToken).then(payload=>{
  const viewer=payload.viewer||{};
  item("cf-menu-login").hidden=Boolean(viewer.authenticated);
  showAccount(viewer,account);
  showStaffTools(viewer);
  item("cf-menu-wiki-panel").hidden=!viewer.isAssignedStaff;
  item("cf-menu-images").hidden=!viewer.canEdit;
  item("cf-menu-templates").hidden=!viewer.isAssignedStaff;
  item("cf-menu-new-page").hidden=!(viewer.authenticated&&viewer.canEdit);
}).catch(()=>{
  showAccount(null, null);
  showStaffTools(null);
  item("cf-menu-login").hidden=false;
  item("cf-menu-wiki-panel").hidden=true;
  item("cf-menu-images").hidden=true;
  item("cf-menu-templates").hidden=true;
  item("cf-menu-new-page").hidden=true;
});
})();