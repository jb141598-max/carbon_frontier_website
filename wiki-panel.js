(function(){
  "use strict";
  const status=document.getElementById("status");
  const workspace=document.getElementById("workspace");
  (async()=>{
    try{
      const data=await window.CFWikiStaff.access();
      const viewer=data.viewer||{};
      if(!viewer.authenticated||!viewer.isAssignedStaff){
        window.CFWikiStaff.showDenied("The Wiki Panel is only available to signed-in Wiki Editors, Admins, and Owners.");
        return;
      }
      for(const a of workspace.querySelectorAll("[data-requires]")){
        a.hidden=!viewer[a.dataset.requires];
      }
      const adminVisible=[...document.querySelectorAll("#admin-links a")].some(a=>!a.hidden);
      document.getElementById("admin-links").hidden=!adminVisible;
      document.getElementById("no-admin").hidden=adminVisible;
      document.getElementById("role-copy").textContent="Signed in as "+(viewer.role||"wiki staff")+".";
      status.hidden=true;workspace.hidden=false;
    }catch(error){window.CFWikiStaff.showDenied(error.message||"Unable to load wiki permissions.")}
  })();
})();