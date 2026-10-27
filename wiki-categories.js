(function(){
  "use strict";
  const API="/.netlify/functions/wiki-categories";
  const $=id=>document.getElementById(id);
  const state={categories:[],expanded:"",details:null,dialogAction:"",dialogCategory:null,
    dialogPage:null,loading:false,canManage:false};
  function feedback(text,error=false,target=$("feedback")){
    target.textContent=text||"";
    target.classList.toggle("error",Boolean(error));
  }
  function el(tag,options={}){
    const node=document.createElement(tag);
    if(options.className)node.className=options.className;
    if(options.text!==undefined)node.textContent=String(options.text);
    if(options.type)node.type=options.type;
    return node;
  }
  async function call({id="",action="",body=null}={}){
    const url=API+(id?"?id="+encodeURIComponent(id):"");
    return window.CFWikiStaff.requestEndpoint(url,body?{method:"POST",body:{action,...body}}:{});
  }
  function closeDialog(){
    if(state.loading)return;
    $("category-dialog").hidden=true;
    state.dialogAction="";state.dialogCategory=null;state.dialogPage=null;
  }
  function openDialog(action,category,page=null){
    state.dialogAction=action;state.dialogCategory=category;state.dialogPage=page;
    $("category-dialog").hidden=false;
    $("rename-field").hidden=action!=="rename";
    $("merge-field").hidden=action!=="merge";
    $("delete-field").hidden=action!=="delete";
    $("rename-input").value=category.name;
    $("delete-confirm").value="";
    $("merge-target").replaceChildren();
    for(const possible of state.categories){
      if(possible.id===category.id)continue;
      const opt=el("option",{text:possible.name});opt.value=possible.id;
      $("merge-target").append(opt);
    }
    const titles={rename:"Rename category",merge:"Merge categories",delete:"Delete category",detach:"Remove page from category"};
    const descriptions={
      rename:"Rename "+category.name+". All existing page memberships will be kept. Links and templates referencing the old category name may need updating.",
      merge:"Combine all pages from "+category.name+" into the destination. "+category.name+" will be removed; pages will not be deleted.",
      delete:"Delete "+category.name+" and remove its membership from all "+category.page_count+" page(s). Wiki pages themselves will remain.",
      detach:"Remove "+(page?.title||"this page")+" from "+category.name+"? The wiki page will remain available."
    };
    $("dialog-title").textContent=titles[action];
    $("dialog-description").textContent=descriptions[action];
    $("dialog-submit").textContent=action==="rename"?"Rename":
      action==="merge"?"Merge into selected category":
      action==="delete"?"Delete category":"Remove from category";
    $("dialog-submit").classList.toggle("danger",action!=="rename");
    feedback("",false,$("dialog-feedback"));
    $("category-form").reset();
    $("rename-input").value=category.name;
    if(action==="rename")$("rename-input").focus();
    else if(action==="merge")$("merge-target").focus();
    else if(action==="delete")$("delete-confirm").focus();
    else $("dialog-submit").focus();
  }
  async function reload({stayExpanded=true}={}){
    const result=await call();
    state.categories=Array.isArray(result.categories)?result.categories:[];
    state.canManage=Boolean(result.viewer?.canManage);
    if(stayExpanded&&state.expanded){
      const found=state.categories.some(c=>c.id===state.expanded);
      if(!found){state.expanded="";state.details=null;}
      else{
        const details=await call({id:state.expanded});
        state.details=details.category;
      }
    }
    render();
  }
  function render(){
    const list=$("categories");list.replaceChildren();
    const search=$("filter").value.trim().toLowerCase();
    const visible=state.categories.filter(c=>c.name.toLowerCase().includes(search));
    $("count").textContent=state.categories.length+" total categories";
    if(!visible.length){
      list.append(el("p",{className:"notice",text:search?"No matching categories.":"There are no categories yet. Add one by assigning it to a wiki page in Page Settings."}));
      return;
    }
    for(const category of visible){
      const card=el("article",{className:"category"});
      const row=el("div",{className:"category-row"});
      const open=el("button",{className:"category-open",type:"button"});
      open.setAttribute("aria-expanded",String(state.expanded===category.id));
      const name=el("div");
      name.append(el("strong",{text:category.name}),el("small",{text:category.page_count+" page"+(category.page_count===1?"":"s")}));
      open.append(name,el("span",{text:state.expanded===category.id?"▲":"▼"}));
      open.addEventListener("click",()=>toggleCategory(category.id));
      const actions=el("div",{className:"actions"});
      for(const [action,label] of [["rename","Rename"],["merge","Merge"],["delete","Delete"]]){
        const btn=el("button",{className:"action"+(action==="delete"?" danger":""),type:"button",text:label});
        btn.disabled=action==="merge"&&state.categories.length<2;
        btn.addEventListener("click",()=>openDialog(action,category));
        actions.append(btn);
      }
      if (state.canManage) row.append(open,actions);
      else row.append(open);
      card.append(row);
      if(state.expanded===category.id){
        const pages=el("div",{className:"pages"});
        const details=state.details;
        if(!details||details.id!==category.id)pages.append(el("p",{className:"sub",text:"Loading pages..."}));
        else if(!details.pages?.length)pages.append(el("p",{className:"sub",text:"No wiki pages are assigned to this category."}));
        else for(const page of details.pages){
          const item=el("div",{className:"page-row"});
          const link=el("a",{text:page.title});link.href="/wiki/"+encodeURIComponent(page.slug);
          const remove=el("button",{className:"action danger",text:"Remove from category",type:"button"});
          remove.addEventListener("click",()=>openDialog("detach",category,page));
          item.append(link);
          if (state.canManage) item.append(remove);
          pages.append(item);
        }
        card.append(pages);
      }
      list.append(card);
    }
  }
  async function toggleCategory(id){
    if(state.expanded===id){state.expanded="";state.details=null;render();return}
    state.expanded=id;state.details=null;render();
    try{
      const result=await call({id});
      if(state.expanded===id){state.details=result.category;render();}
    }catch(error){feedback(error.message,true);}
  }
  async function submitAction(event){
    event.preventDefault();
    if(state.loading||!state.dialogCategory)return;
    const action=state.dialogAction,category=state.dialogCategory;
    const body={id:category.id};
    if(action==="rename"){
      body.name=$("rename-input").value.trim();
      if(!body.name){feedback("Enter a category name.",true,$("dialog-feedback"));return;}
    } else if(action==="merge"){
      body.targetId=$("merge-target").value;
      if(!body.targetId){feedback("Choose a destination category.",true,$("dialog-feedback"));return;}
    } else if(action==="delete"){
      body.confirmName=$("delete-confirm").value;
      if(body.confirmName!==category.name){
        feedback("Type the category name exactly to confirm deletion.",true,$("dialog-feedback"));return;
      }
    } else if(action==="detach"){
      body.pageId=state.dialogPage?.id;
    }
    state.loading=true;$("dialog-submit").disabled=true;
    feedback("Saving...",false,$("dialog-feedback"));
    try{
      const result=await call({body:{action,...body}});
      state.loading=false;
      closeDialog();
      if(action==="merge"){
        state.expanded=result.result?.id||"";
      }else if(action==="delete"){
        state.expanded="";state.details=null;
      }
      await reload();
      feedback(
        action==="rename"?"Category renamed.":
        action==="merge"?"Categories merged. Existing wiki pages were preserved.":
        action==="delete"?"Category deleted. No wiki pages were deleted.":
        "Page removed from the category."
      );
    }catch(error){
      feedback(error.message||"Could not modify category.",true,$("dialog-feedback"));
    }finally{state.loading=false;$("dialog-submit").disabled=false;}
  }
  $("category-form").addEventListener("submit",submitAction);
  $("dialog-x").addEventListener("click",closeDialog);
  $("dialog-cancel").addEventListener("click",closeDialog);
  $("filter").addEventListener("input",render);
  // The confirmation dialog cannot be dismissed by accidentally clicking
  // outside; use X or Cancel, matching the rest of the wiki's overlays.
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!$("category-dialog").hidden)event.preventDefault();
  });
  (async()=>{
    try{
      const access=await window.CFWikiStaff.access();
      if(!access.viewer?.canView){
        window.CFWikiStaff.showDenied("The wiki is private. Sign in with an authorized account to browse categories.");
        return;
      }
      await reload({stayExpanded:false});
      $("status").hidden=true;$("workspace").hidden=false;
    }catch(error){window.CFWikiStaff.showDenied(error.message||"Unable to load categories.");}
  })();
})();