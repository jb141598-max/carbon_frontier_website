(function(){
"use strict";
const toggle=document.getElementById("cf-site-menu-toggle");
const menu=document.getElementById("cf-site-menu");
if(!toggle||!menu)return;
const item=(id)=>document.getElementById(id);
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
const raw=localStorage.getItem("carbon-frontier-google-session-v1");
let account=null;
try{account=JSON.parse(raw||"null")}catch{}
item("cf-menu-login").hidden=Boolean(account?.idToken);
if(!account?.idToken)return;
fetch("/api/wiki-access",{
  cache:"no-store",
  headers:{authorization:"Bearer "+account.idToken,accept:"application/json"}
}).then(async response=>{
  if(!response.ok)throw new Error("Wiki session unavailable.");
  return response.json();
}).then(payload=>{
  const viewer=payload.viewer||{};
  item("cf-menu-login").hidden=Boolean(viewer.authenticated);
  item("cf-menu-wiki-panel").hidden=!viewer.isAssignedStaff;
  item("cf-menu-images").hidden=!viewer.canEdit;
  item("cf-menu-templates").hidden=!viewer.isAssignedStaff;
  item("cf-menu-new-page").hidden=!(viewer.authenticated&&viewer.canEdit);
}).catch(()=>{
  item("cf-menu-login").hidden=false;
  item("cf-menu-wiki-panel").hidden=true;
  item("cf-menu-images").hidden=true;
  item("cf-menu-templates").hidden=true;
  item("cf-menu-new-page").hidden=true;
});
})();