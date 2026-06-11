"use strict";
(function(){
  /* ---------------- storage abstraction ----------------
     Priority: Backend API → Claude artifact storage → localStorage → in-memory
     Backend URL is configured via window.__BACKEND__ in config.js
       null / undefined  = localStorage only (GitHub Pages / offline)
       ""                = same-origin API (frontend served by backend)
       "https://..."     = remote backend URL                              */
  const BACKEND = (typeof window !== "undefined" && window.__BACKEND__ != null) ? window.__BACKEND__ : null;
  const hasWS   = (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function");
  const mem = {};

  async function _apiFetch(method, path, body){
    const opts = { method, headers:{} };
    if(body !== undefined){ opts.headers["Content-Type"]="application/json"; opts.body=JSON.stringify(body); }
    const r = await fetch(BACKEND + path, opts);
    if(!r.ok) throw new Error("API " + r.status);
    return r.json();
  }

  const Store = {
    async get(k){
      if(BACKEND !== null){ try{ const j=await _apiFetch("GET","/api/kv?k="+encodeURIComponent(k)); return j.value; }catch{} }
      if(hasWS){ try{ const r=await window.storage.get(k); return r ? r.value : null; }catch{ return null; } }
      try{ return localStorage.getItem(k); }catch{ return (k in mem) ? mem[k] : null; }
    },
    async set(k,v){
      if(BACKEND !== null){ try{ await _apiFetch("PUT","/api/kv?k="+encodeURIComponent(k),{value:v}); return true; }catch{} }
      if(hasWS){ try{ await window.storage.set(k,v); return true; }catch{ return false; } }
      try{ localStorage.setItem(k,v); return true; }catch{ mem[k]=v; return true; }
    },
    async del(k){
      if(BACKEND !== null){ try{ await _apiFetch("DELETE","/api/kv?k="+encodeURIComponent(k)); return; }catch{} }
      if(hasWS){ try{ await window.storage.delete(k); }catch{} return; }
      try{ localStorage.removeItem(k); }catch{ delete mem[k]; }
    },
    async keys(prefix){
      if(BACKEND !== null){ try{ const j=await _apiFetch("GET","/api/kv/keys?prefix="+encodeURIComponent(prefix)); return j.keys||[]; }catch{} }
      if(hasWS){ try{ const r=await window.storage.list(prefix); return (r && r.keys) ? r.keys : []; }catch{ return []; } }
      try{ return Object.keys(localStorage).filter(k=>k.startsWith(prefix)); }catch{ return Object.keys(mem).filter(k=>k.startsWith(prefix)); }
    }
  };
  const RKEY = d => "dsr:report:" + d;
  const SKEY = "dsr:settings";

  /* ---------------- helpers ---------------- */
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const todayISO = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  const TH_DAY=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  const TH_MON=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  function thaiDate(iso){ if(!iso) return "—"; const p=iso.split("-"); const d=new Date(+p[0],+p[1]-1,+p[2]); if(isNaN(d)) return iso;
    return "วัน"+TH_DAY[d.getDay()]+"ที่ "+(+p[2])+" "+TH_MON[+p[1]-1]+" "+(+p[0]+543); }
  const esc = s => (s==null ? "" : String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  function resizeImage(file, maxDim, quality){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>{ const img=new Image();
        img.onload=()=>{ let w=img.width,h=img.height; const sc=Math.min(1,maxDim/Math.max(w,h));
          const cw=Math.round(w*sc), ch=Math.round(h*sc);
          const cv=document.createElement("canvas"); cv.width=cw; cv.height=ch;
          const cx=cv.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,cw,ch); cx.drawImage(img,0,0,cw,ch);
          res(cv.toDataURL("image/jpeg",quality)); };
        img.onerror=rej; img.src=r.result; };
      r.onerror=rej; r.readAsDataURL(file);
    });
  }
  function download(filename, href){ const a=document.createElement("a"); a.download=filename; a.href=href; document.body.appendChild(a); a.click(); a.remove(); }

  /* ---------------- state ---------------- */
  const defaultMp = ()=>[{role:"วิศวกรควบคุมงาน",qty:1},{role:"หัวหน้าช่าง",qty:1},{role:"ช่างเทคนิค",qty:0},{role:"ผู้ช่วยช่าง",qty:0},{role:"จป. / Safety",qty:1}];
  let settings = { company:"", tagline:"", logo:"", accent:"#15577d", docTitle:"รายงานปฏิบัติงานประจำวัน", defProject:"", defClient:"", defLocation:"", mpPreset:defaultMp() };
  let state = blankReport();
  let saveTimer=null;

  function blankReport(){
    return { date:todayISO(), reportNo:"", project:settings.defProject||"", client:settings.defClient||"", location:settings.defLocation||"",
      weather:"", shift:"08:00–17:00", manpower:JSON.parse(JSON.stringify(settings.mpPreset||defaultMp())),
      works:"", issues:"", plan:"", notes:"", photos:[], photoLayout:"2x2",
      preparedBy:"", preparedRole:"", reviewedBy:"", reviewedRole:"", clientBy:"",
      signs:{prepared:"",reviewed:"",client:""} };
  }

  /* ---------------- photo pagination ---------------- */
  function paginate(){
    const layout = state.photoLayout;
    const firstCap = layout==="1x3" ? 3 : 4;
    const contCols = layout==="1x3" ? 3 : 2;
    const contCap  = contCols * 3;            // 9 (1x3) or 6 (2x2) per continuation page
    const photos = state.photos || [];
    const first = photos.slice(0, firstCap);
    const rest  = photos.slice(firstCap);
    const contPages = [];
    for(let i=0;i<rest.length;i+=contCap) contPages.push(rest.slice(i,i+contCap));
    return { layout, firstCap, contCols, first, contPages };
  }
  function photoCell(p){
    return "<div class='photo'><div class='img' style=\"background-image:url('"+p.data+"')\"></div>"+
           (p.caption ? "<div class='pcap'>"+esc(p.caption)+"</div>" : "")+"</div>";
  }

  /* ---------------- render ---------------- */
  function setSign(id,data){ const el=$("#"+id); if(!el) return; if(data){ el.src=data; el.style.display="block"; } else { el.removeAttribute("src"); el.style.display="none"; } }

  function render(){
    document.documentElement.style.setProperty("--accent", settings.accent||"#15577d");
    // brand
    const lg=$("#pvLogo");
    lg.innerHTML = settings.logo ? "<img src='"+settings.logo+"' alt='logo'>" : "<span class='ph'>LOGO</span>";
    $("#pvCompany").textContent = settings.company || "ชื่อบริษัทของคุณ";
    $("#pvTagline").textContent = settings.tagline || "";
    $("#pvDocTitle").textContent = settings.docTitle || "รายงานปฏิบัติงานประจำวัน";
    const mk=(settings.company||"SR").trim().replace(/[^A-Za-zก-๙]/g,"").slice(0,2).toUpperCase()||"SR";
    $("#ctlMark").textContent = mk;
    // title block
    $("#pvProject").textContent  = state.project||"—";
    $("#pvClient").textContent   = state.client||"—";
    $("#pvLocation").textContent = state.location||"—";
    $("#pvDate").textContent     = thaiDate(state.date);
    $("#pvReportNo").textContent = state.reportNo||"—";
    $("#pvWeather").textContent  = state.weather||"—";
    $("#pvShift").textContent    = state.shift||"—";
    // manpower
    const total = state.manpower.reduce((s,r)=>s+(+r.qty||0),0);
    $("#pvMpHead").textContent = total;
    $("#pvMpTotal").textContent = total;
    $("#pvMp").innerHTML = state.manpower.filter(r=>r.role||+r.qty).map(r=>
      "<tr><td>"+esc(r.role||"—")+"</td><td class='q'>"+(+r.qty||0)+"</td></tr>").join("") || "<tr><td>—</td><td class='q'>0</td></tr>";
    // prose
    $("#pvWorks").textContent  = state.works||"";
    $("#pvIssues").textContent = state.issues||"";
    $("#pvPlan").textContent   = state.plan||"";
    $("#pvNotes").textContent  = state.notes||"";

    // photos + pagination
    const pg = paginate();
    const box=$("#pvPhotos"); box.dataset.layout = pg.layout;
    let html="";
    for(let i=0;i<pg.firstCap;i++){
      const p=pg.first[i];
      html += p ? photoCell(p) : "<div class='photo empty'><div class='img'>รูปที่ "+(i+1)+"</div></div>";
    }
    box.innerHTML = html;

    const totalPages = 1 + pg.contPages.length;
    // remove old continuation pages, build new ones
    $$("#pages .page.cont").forEach(el=>el.remove());
    const pagesWrap = $("#pages");
    pg.contPages.forEach((slice, idx)=>{
      const pageNo = idx+2;
      const div=document.createElement("div");
      div.className="page cont";
      const cols = pg.contCols;
      const cells = slice.map(photoCell).join("");
      div.innerHTML =
        "<span class='tick tl'></span><span class='tick tr'></span><span class='tick bl'></span><span class='tick br'></span>"+
        "<header class='cont-head'>"+
          "<div class='rpt-brand'>"+
            "<div class='rpt-logo'>"+(settings.logo?("<img src='"+settings.logo+"' alt=''>"):"<span class='ph'>LOGO</span>")+"</div>"+
            "<div><div class='rpt-company'>"+esc(settings.company||"ชื่อบริษัทของคุณ")+"</div></div>"+
          "</div>"+
          "<div class='cont-meta'><b>ภาพประกอบ (ต่อ)</b>"+esc(state.project||"")+" · "+thaiDate(state.date)+"</div>"+
        "</header>"+
        "<div class='rpt-accentrule'></div>"+
        "<div class='photos' style='grid-template-columns:repeat("+cols+",1fr)'>"+cells+"</div>"+
        "<div class='pfoot'><span>"+esc(settings.company||"")+"</span><span>หน้า "+pageNo+"/"+totalPages+"</span></div>";
      pagesWrap.appendChild(div);
    });

    // signatures
    $("#pvPrepName").textContent = state.preparedBy||"—";
    $("#pvPrepRole").textContent = state.preparedRole||"";
    $("#pvRevName").textContent  = state.reviewedBy||"—";
    $("#pvRevRole").textContent  = state.reviewedRole||"";
    $("#pvCliName").textContent  = state.clientBy||"—";
    setSign("pvPrepSign", state.signs && state.signs.prepared);
    setSign("pvRevSign",  state.signs && state.signs.reviewed);
    setSign("pvCliSign",  state.signs && state.signs.client);

    // footer
    $("#pvFootCo").textContent  = settings.company||"";
    $("#pvFootGen").textContent = "สร้างเมื่อ "+new Date().toLocaleString("th-TH",{dateStyle:"medium",timeStyle:"short"});
    $("#pvFootPage").textContent= "หน้า 1/"+totalPages;

    fitPage();
  }

  /* ---------------- fit pages to viewport ---------------- */
  function fitPage(){
    const scaler=$("#scaler"), pages=$("#pages"), viewer=$("#viewer");
    if(!viewer || !viewer.clientWidth) return;
    const avail = viewer.clientWidth - 52;
    const natW = pages.offsetWidth, natH = pages.offsetHeight;
    let sc = Math.min(1, avail/natW);
    if(!isFinite(sc) || sc<=0) sc=1;
    scaler.style.transform = "scale("+sc+")";
    scaler.style.width  = natW+"px";
    scaler.style.height = (natH*sc)+"px";
  }
  window.addEventListener("resize", fitPage);
  window.addEventListener("load", fitPage);

  /* ---------------- form binding ---------------- */
  function setPath(o,path,val){ const ks=path.split("."); let t=o; for(let i=0;i<ks.length-1;i++) t=t[ks[i]]; t[ks[ks.length-1]]=val; }
  function bindForm(){
    $("#pane-edit").addEventListener("input", e=>{ const f=e.target.dataset.field; if(!f) return; setPath(state,f,e.target.value); scheduleSave(); render(); });
  }
  function fillForm(){
    $$("#pane-edit [data-field]").forEach(el=>{ el.value = state[el.dataset.field] ?? ""; });
    renderMpRows(); renderPhList(); updateSignerUI();
    $$(".lay-toggle button").forEach(b=>b.classList.toggle("on", b.dataset.lay===state.photoLayout));
  }

  /* ---------------- manpower editor ---------------- */
  function renderMpRows(){
    const box=$("#mpRows"); box.innerHTML="";
    state.manpower.forEach((r,i)=>{
      const div=document.createElement("div"); div.className="mp-row";
      const role=document.createElement("input"); role.className="in role"; role.placeholder="ตำแหน่ง"; role.value=r.role||"";
      const qty=document.createElement("input"); qty.className="in qty"; qty.type="number"; qty.min="0"; qty.value=(+r.qty||0);
      const del=document.createElement("button"); del.className="icon-btn"; del.title="ลบ"; del.textContent="✕";
      role.addEventListener("input",e=>{state.manpower[i].role=e.target.value;scheduleSave();render();});
      qty.addEventListener("input",e=>{state.manpower[i].qty=e.target.value;scheduleSave();render();});
      del.addEventListener("click",()=>{state.manpower.splice(i,1);scheduleSave();renderMpRows();render();});
      div.append(role,qty,del); box.appendChild(div);
    });
  }
  $("#addMp").addEventListener("click",()=>{ state.manpower.push({role:"",qty:0}); scheduleSave(); renderMpRows(); render(); });

  /* ---------------- photos editor ---------------- */
  $$(".lay-toggle button").forEach(b=>b.addEventListener("click",()=>{ state.photoLayout=b.dataset.lay;
    $$(".lay-toggle button").forEach(x=>x.classList.toggle("on",x===b)); scheduleSave(); render(); }));
  $("#addPhoto").addEventListener("click",()=>$("#photoInput").click());
  $("#photoInput").addEventListener("change", async e=>{
    const files=Array.from(e.target.files||[]);
    for(const f of files){ try{ const data=await resizeImage(f,1500,0.72); state.photos.push({data,caption:""}); }catch{} }
    e.target.value=""; scheduleSave(); renderPhList(); render();
  });
  function renderPhList(){
    const box=$("#phList"); box.innerHTML="";
    state.photos.forEach((p,i)=>{
      const d=document.createElement("div"); d.className="ph-item";
      const rm=document.createElement("button"); rm.className="rm"; rm.textContent="✕";
      const img=document.createElement("img"); img.src=p.data;
      const cap=document.createElement("input"); cap.className="cap"; cap.placeholder="คำบรรยายรูป "+(i+1); cap.value=p.caption||"";
      rm.addEventListener("click",()=>{state.photos.splice(i,1);scheduleSave();renderPhList();render();});
      cap.addEventListener("input",e=>{state.photos[i].caption=e.target.value;scheduleSave();render();});
      d.append(rm,img,cap); box.appendChild(d);
    });
  }

  /* ---------------- signature pad ---------------- */
  let signTarget=null, signCtx=null, drawing=false, last=null;
  const signCanvas = $("#signCanvas");
  function openSign(target){
    signTarget=target;
    $("#signTitle").textContent = "วาดลายเซ็น — " + ({prepared:"ผู้จัดทำ",reviewed:"ผู้ตรวจสอบ",client:"ฝ่ายลูกค้า"}[target]||"");
    const modal=$("#signModal"); modal.hidden=false;
    const rect=signCanvas.getBoundingClientRect();
    const dpr=window.devicePixelRatio||1;
    signCanvas.width=Math.round(rect.width*dpr); signCanvas.height=Math.round(rect.height*dpr);
    signCtx=signCanvas.getContext("2d"); signCtx.scale(dpr,dpr);
    signCtx.lineWidth=2.2; signCtx.lineCap="round"; signCtx.lineJoin="round"; signCtx.strokeStyle="#10243a";
    signCtx.clearRect(0,0,rect.width,rect.height);
  }
  function closeSign(){ $("#signModal").hidden=true; signTarget=null; drawing=false; }
  function sigPos(e){ const r=signCanvas.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
  signCanvas.addEventListener("pointerdown",e=>{ if(!signCtx)return; drawing=true; last=sigPos(e); signCanvas.setPointerCapture(e.pointerId); });
  signCanvas.addEventListener("pointermove",e=>{ if(!drawing||!signCtx)return; const p=sigPos(e);
    signCtx.beginPath(); signCtx.moveTo(last.x,last.y); signCtx.lineTo(p.x,p.y); signCtx.stroke(); last=p; });
  signCanvas.addEventListener("pointerup",()=>drawing=false);
  signCanvas.addEventListener("pointercancel",()=>drawing=false);
  $("#signClearBtn").addEventListener("click",()=>{ if(signCtx){ const r=signCanvas.getBoundingClientRect(); signCtx.clearRect(0,0,r.width,r.height); } });
  $("#signClose").addEventListener("click",closeSign);
  $("#signModal").addEventListener("click",e=>{ if(e.target.id==="signModal") closeSign(); });
  $("#signSaveBtn").addEventListener("click",()=>{ if(!signTarget) return;
    state.signs[signTarget] = signCanvas.toDataURL("image/png");
    scheduleSave(); updateSignerUI(); render(); closeSign(); });

  function updateSignerUI(){
    ["prepared","reviewed","client"].forEach(k=>{
      const data = state.signs && state.signs[k];
      const thumb=$("[data-sgthumb='"+k+"']"), clr=$("[data-sgclear='"+k+"']");
      if(data){ thumb.src=data; thumb.hidden=false; clr.hidden=false; }
      else { thumb.removeAttribute("src"); thumb.hidden=true; clr.hidden=true; }
    });
  }
  $("#pane-edit").addEventListener("click", e=>{
    const sg=e.target.closest("[data-sign]"); if(sg){ openSign(sg.dataset.sign); return; }
    const cl=e.target.closest("[data-sgclear]"); if(cl){ const k=cl.dataset.sgclear; state.signs[k]=""; scheduleSave(); updateSignerUI(); render(); }
  });

  /* ---------------- save / load ---------------- */
  function setSaving(on){ const dot=$("#saveDot"),t=$("#saveText");
    if(on){ dot.classList.add("saving"); t.textContent="กำลังบันทึก…"; }
    else { dot.classList.remove("saving"); t.textContent="บันทึกแล้ว · "+new Date().toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}); } }
  function scheduleSave(){ setSaving(true); clearTimeout(saveTimer); saveTimer=setTimeout(saveReport,650); }
  async function saveReport(){ await Store.set(RKEY(state.date), JSON.stringify(state)); setSaving(false); }
  async function saveSettings(){ await Store.set(SKEY, JSON.stringify(settings)); }

  async function loadSettings(){ const raw=await Store.get(SKEY); if(raw){ try{ Object.assign(settings, JSON.parse(raw)); }catch{} }
    $$("#pane-settings [data-set]").forEach(el=>{ el.value=settings[el.dataset.set] ?? ""; });
    $("#accentInput").value=settings.accent||"#15577d";
    if(settings.logo){ $("#logoPrev").hidden=false; $("#logoPrevImg").src=settings.logo; $("#logoDrop").style.display="none"; }
    else { $("#logoPrev").hidden=true; $("#logoDrop").style.display=""; }
  }
  async function loadReport(date){ const raw=await Store.get(RKEY(date));
    if(raw){ try{ const o=JSON.parse(raw); state=Object.assign(blankReport(), o); if(o.signs) state.signs=Object.assign({prepared:"",reviewed:"",client:""},o.signs); }catch{ state=blankReport(); state.date=date; } }
    else { state=blankReport(); state.date=date; }
    fillForm(); render(); setSaving(false);
  }

  /* ---------------- history ---------------- */
  async function renderHistory(){
    const keys=await Store.keys("dsr:report:");
    const list=$("#histList");
    if(!keys.length){ list.innerHTML="<div class='hist-empty'>ยังไม่มีรายงานที่บันทึกไว้<br>กรอกข้อมูลในแท็บ "แก้ไข" ระบบจะบันทึกอัตโนมัติ</div>"; return; }
    const items=[];
    for(const k of keys){ const raw=await Store.get(k); if(!raw) continue; try{ items.push(JSON.parse(raw)); }catch{} }
    items.sort((a,b)=> (a.date<b.date?1:-1));
    list.innerHTML=items.map(r=>{
      const snip=(r.works||r.issues||"").replace(/\n/g," ").slice(0,60);
      const cur = r.date===state.date ? " cur":"";
      return "<div class='hist-item"+cur+"' data-d='"+r.date+"'>"+
        "<div class='hist-date'>"+r.date+(r.reportNo?" · "+esc(r.reportNo):"")+"</div>"+
        "<div class='hist-proj'>"+esc(r.project||"(ไม่ระบุโครงการ)")+"</div>"+
        "<div class='hist-snip'>"+(esc(snip)||"—")+"</div>"+
        "<div class='hist-actions'><button class='open'>เปิด</button><button class='dup'>ทำสำเนาวันนี้</button><button class='del'>ลบ</button></div></div>";
    }).join("");
    list.querySelectorAll(".hist-item").forEach(el=>{
      const d=el.dataset.d;
      el.querySelector(".open").addEventListener("click",async()=>{ await loadReport(d); switchPane("edit"); if(window.innerWidth<=880) showPreview(false); });
      el.querySelector(".dup").addEventListener("click",async()=>{ const raw=await Store.get(RKEY(d)); if(!raw) return;
        let src; try{ src=JSON.parse(raw); }catch{ alert("ข้อมูลรายงานเสียหาย อ่านไม่ได้"); return; }
        state=Object.assign(blankReport(),src); state.date=todayISO(); state.reportNo=""; state.photos=[]; state.plan=""; state.notes="";
        state.signs={prepared:"",reviewed:"",client:""};
        fillForm(); render(); await saveReport(); switchPane("edit"); });
      el.querySelector(".del").addEventListener("click",async()=>{ if(!confirm("ลบรายงานวันที่ "+d+" ?")) return; await Store.del(RKEY(d)); renderHistory(); });
    });
  }

  /* ---------------- settings handlers ---------------- */
  $("#pane-settings").addEventListener("input", e=>{ const s=e.target.dataset.set; if(!s) return; settings[s]=e.target.value; saveSettings(); render(); });
  $("#accentInput").addEventListener("input", e=>{ settings.accent=e.target.value; saveSettings(); render(); });
  const SW=["#15577d","#0e6e62","#1f3a8a","#8a3324","#3b3f46","#2f6d3a"];
  $("#swatches").innerHTML=SW.map(c=>"<button style='background:"+c+"' data-c='"+c+"'></button>").join("");
  $("#swatches").addEventListener("click",e=>{ const c=e.target.dataset.c; if(!c) return; settings.accent=c; $("#accentInput").value=c; saveSettings(); render(); });
  $("#logoDrop").addEventListener("click",()=>$("#logoInput").click());
  $("#logoInput").addEventListener("change", async e=>{ const f=e.target.files[0]; if(!f) return;
    settings.logo=await resizeImage(f,420,0.85); $("#logoPrev").hidden=false; $("#logoPrevImg").src=settings.logo; $("#logoDrop").style.display="none"; saveSettings(); render(); e.target.value=""; });
  $("#logoRm").addEventListener("click",()=>{ settings.logo=""; $("#logoPrev").hidden=true; $("#logoDrop").style.display=""; saveSettings(); render(); });
  $("#saveMpPreset").addEventListener("click",()=>{ settings.mpPreset=JSON.parse(JSON.stringify(state.manpower)); saveSettings();
    $("#saveMpPreset").textContent="บันทึกแล้ว ✓"; setTimeout(()=>$("#saveMpPreset").textContent="บันทึกกำลังคนปัจจุบันเป็นค่าเริ่มต้น",1500); });

  /* ---------------- export / import data ---------------- */
  $("#exportData").addEventListener("click", async ()=>{
    const keys=await Store.keys("dsr:report:"); const reports={};
    for(const k of keys){ const v=await Store.get(k); if(v!=null){ try{ reports[k]=JSON.parse(v); }catch{} } }
    const blob={ _app:"daily-site-report", _v:1, exportedAt:new Date().toISOString(), settings, reports };
    const url=URL.createObjectURL(new Blob([JSON.stringify(blob,null,2)],{type:"application/json"}));
    download("daily-report-backup-"+todayISO()+".json", url);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  });
  $("#importData").addEventListener("click",()=>$("#importInput").click());
  $("#importInput").addEventListener("change", e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=async()=>{
      let data; try{ data=JSON.parse(r.result); }catch{ alert("ไฟล์ไม่ถูกต้อง: อ่าน JSON ไม่ได้"); return; }
      if(data._app!=="daily-site-report"){ if(!confirm("ไฟล์นี้อาจไม่ใช่ไฟล์สำรองของแอปนี้ ต้องการนำเข้าต่อหรือไม่?")) return; }
      const n=Object.keys(data.reports||{}).length;
      if(!confirm("นำเข้าจะเขียนทับการตั้งค่าปัจจุบัน และรวมรายงาน "+n+" ฉบับเข้าด้วยกัน ดำเนินการต่อ?")) return;
      if(data.settings){ Object.assign(settings,data.settings); await saveSettings(); }
      for(const [k,v] of Object.entries(data.reports||{})){ await Store.set(k, JSON.stringify(v)); }
      await loadSettings(); await loadReport(state.date); renderHistory();
      alert("นำเข้าข้อมูลสำเร็จ ("+n+" ฉบับ)");
    };
    r.readAsText(f); e.target.value="";
  });

  /* ---------------- top actions ---------------- */
  $("#newBtn").addEventListener("click",async()=>{ await saveReport(); state=blankReport(); fillForm(); render(); await saveReport(); switchPane("edit"); });
  $("#dupBtn").addEventListener("click",async()=>{ const keys=(await Store.keys("dsr:report:")).sort(); if(!keys.length){ alert("ยังไม่มีรายงานก่อนหน้า"); return; }
    const raw=await Store.get(keys[keys.length-1]); if(!raw) return;
    let src; try{ src=JSON.parse(raw); }catch{ alert("ข้อมูลรายงานเสียหาย อ่านไม่ได้"); return; }
    state=Object.assign(blankReport(),src); state.date=todayISO(); state.photos=[]; state.works=""; state.issues=""; state.plan=""; state.notes=""; state.reportNo="";
    state.signs={prepared:"",reviewed:"",client:""};
    fillForm(); render(); await saveReport(); switchPane("edit"); });

  /* ---------------- export PDF / image ---------------- */
  function fileBase(){ return ("DailyReport_"+(state.date||"")+"_"+(state.reportNo||state.project||"").replace(/[^\w฀-๿-]/g,"_")).replace(/_+/g,"_").replace(/_$/,""); }
  $("#pdfBtn").addEventListener("click",()=>{ document.body.classList.add("exporting"); window.print(); setTimeout(()=>document.body.classList.remove("exporting"),600); });
  $("#imgBtn").addEventListener("click", async ()=>{
    if(typeof html2canvas!=="function"){ alert("ตัวช่วยส่งออกรูปยังโหลดไม่สำเร็จ (ต้องต่ออินเทอร์เน็ตครั้งแรก) — ใช้ปุ่ม 'บันทึก PDF' แทนได้เลย"); return; }
    const scaler=$("#scaler"); const prev=scaler.style.transform, prevH=scaler.style.height;
    document.body.classList.add("exporting"); scaler.style.transform="none"; scaler.style.height="auto";
    try{
      const pages=$$("#pages .page");
      const canvases=[];
      for(const p of pages){ canvases.push(await html2canvas(p,{scale:2,useCORS:true,backgroundColor:"#ffffff",windowWidth:p.scrollWidth,windowHeight:p.scrollHeight})); }
      if(canvases.length===1){ download(fileBase()+".png", canvases[0].toDataURL("image/png")); }
      else {
        const gap=24; const w=Math.max(...canvases.map(c=>c.width));
        const h=canvases.reduce((s,c)=>s+c.height,0)+gap*(canvases.length-1);
        const m=document.createElement("canvas"); m.width=w; m.height=h;
        const cx=m.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,w,h);
        let y=0; for(const c of canvases){ cx.drawImage(c,Math.round((w-c.width)/2),y); y+=c.height+gap; }
        download(fileBase()+".png", m.toDataURL("image/png"));
      }
    }catch(err){ alert("ส่งออกรูปไม่สำเร็จ: "+err.message); }
    finally{ document.body.classList.remove("exporting"); scaler.style.transform=prev; scaler.style.height=prevH; fitPage(); }
  });

  /* ---------------- panes / mobile tabs ---------------- */
  function switchPane(name){ $$(".seg button").forEach(b=>b.classList.toggle("on",b.dataset.pane===name));
    $$(".pane").forEach(p=>p.classList.toggle("on",p.id==="pane-"+name)); if(name==="history") renderHistory(); }
  $$(".seg button").forEach(b=>b.addEventListener("click",()=>switchPane(b.dataset.pane)));
  function showPreview(on){ document.body.classList.toggle("show-preview",on);
    $("#mPrev").classList.toggle("on",on); $("#mEdit").classList.toggle("on",!on); if(on) setTimeout(fitPage,50); }
  $("#mEdit").addEventListener("click",()=>showPreview(false));
  $("#mPrev").addEventListener("click",()=>showPreview(true));

  /* ---------------- init ---------------- */
  (async function init(){
    await loadSettings();
    await loadReport(todayISO());
    bindForm();
    render();
    setTimeout(fitPage,300);
  })();
})();
