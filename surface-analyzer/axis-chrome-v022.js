(function(root){
  'use strict';
  const VERSION='axis-chrome-v022';
  let installed=false,plans=null;

  const pretty=s=>String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const defsById=d=>Object.fromEntries((d.parameters||[]).map(p=>[p.id,p]));
  function valueLabel(def,raw){
    if(raw==null||raw==='')return '';
    const labels=def?.value_labels||{};
    return labels[String(raw)]??String(raw);
  }
  function shortValue(s){
    s=String(s??'');
    return s.replace(/Inverse Distance/gi,'Inverse').replace(/Exponential/gi,'Exp').replace(/Gaussian/gi,'Gauss').replace(/London 50%/gi,'L50').replace(/London 75%/gi,'L75');
  }
  function shortName(s){
    s=String(s||'').replace(/London Range/gi,'').replace(/Trade Management/gi,'Management').replace(/Price Differential Weighting/gi,'Weighting').replace(/Distance Scale Mode/gi,'Scale Mode').replace(/Maximum Trades \/ Day/gi,'Trades / Day').replace(/Max Trades \/ Day/gi,'Trades / Day').replace(/ Points/gi,'').replace(/ ATR Ratio/gi,' Ratio').replace(/ Mode/gi,'').trim();
    return s||'Parameter';
  }
  function candidateList(d,axis){
    const defs=defsById(d),order=[...(d.layout?.[`${axis}_parameter_order`]||[])],slots=(d.layout?.virtual_slots||[]).filter(s=>s.axis===axis),slotMembers=new Set(slots.flatMap(s=>s.parameters||[])),after=new Map();
    for(const s of slots){const a=after.get(s.after)||[];a.push(s);after.set(s.after,a);}
    const out=[];
    const addParam=id=>{const def=defs[id];if(!def)return;out.push({id,name:def.label||pretty(id),role:def.topology_role||'ordered',order:out.length,get(sem){const raw=sem?.[id]??'';return {key:raw===''?'':`${id}:${raw}`,label:shortValue(valueLabel(def,raw))};}});};
    const addSlot=s=>out.push({id:s.id,name:s.label||pretty(s.id),role:'ordered',order:out.length,get(sem){for(const id of s.parameters||[]){const raw=sem?.[id]??'';if(raw!==''){const def=defs[id];return {key:`${id}:${raw}`,label:shortValue(valueLabel(def,raw))};}}return {key:'',label:''};}});
    for(const id of order){if(!slotMembers.has(id))addParam(id);for(const s of after.get(id)||[])addSlot(s);}
    for(const s of slots)if(!out.some(x=>x.id===s.id))addSlot(s);
    return out;
  }
  function runsFor(candidate,items){
    const runs=[];let start=0,prev=null,prevLabel='';
    for(let i=0;i<items.length;i++){
      const v=candidate.get(items[i]);
      if(i===0){prev=v.key;prevLabel=v.label;start=0;continue;}
      if(v.key!==prev){runs.push({start,end:i,key:prev,label:prevLabel});start=i;prev=v.key;prevLabel=v.label;}
    }
    if(items.length)runs.push({start,end:items.length,key:prev,label:prevLabel});
    return runs;
  }
  function assess(candidate,items,axisPx,axis){
    const runs=runsFor(candidate,items),minPx=axis==='x'?34:14,active=runs.filter(r=>r.key&&r.label),labelable=active.filter(r=>(r.end-r.start)/Math.max(1,items.length)*axisPx>=minPx),coverage=labelable.reduce((s,r)=>s+(r.end-r.start),0)/Math.max(1,items.length),role=candidate.role==='regime'?100:candidate.role==='facet'?14:10;
    const avgPx=active.length?active.reduce((s,r)=>s+(r.end-r.start)/items.length*axisPx,0)/active.length:0;
    return {...candidate,runs,score:role+coverage*25+Math.min(10,avgPx/16)-Math.log2(active.length+1)-candidate.order*.05};
  }
  function choose(d,axis,items,axisPx){
    const assessed=candidateList(d,axis).map(c=>assess(c,items,axisPx,axis));
    if(assessed.length<=3)return assessed;
    const regimes=assessed.filter(x=>x.role==='regime').sort((a,b)=>a.order-b.order),chosen=[];
    if(regimes.length)chosen.push(regimes[0]);
    for(const c of assessed.filter(x=>!chosen.includes(x)).sort((a,b)=>b.score-a.score))if(chosen.length<3)chosen.push(c);
    return chosen.sort((a,b)=>a.order-b.order);
  }
  function injectStyle(){
    if(document.getElementById('axisChromeV022Style'))return;
    const s=document.createElement('style');s.id='axisChromeV022Style';s.textContent=`
      .yside.sa-yaxis{display:grid!important;gap:0;align-items:stretch;min-height:480px}
      .sa-y-level{position:relative;min-width:0;border-left:1px solid #27323d}
      .sa-y-level-name{position:absolute;top:-15px;left:0;right:0;text-align:center;font-size:8px;line-height:12px;font-weight:750;letter-spacing:.04em;color:#687684;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sa-y-span{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1px 3px;border-top:1px dashed rgba(160,174,188,.24);font-size:9px;line-height:10px;color:#aeb9c4;overflow:hidden;word-break:normal}
      .sa-y-level.regime .sa-y-span{font-weight:750;color:#d5dde5;border-top:2px solid rgba(230,237,244,.72)}
      .sa-axis-band{position:relative;height:25px;border-top:1px solid #28343f;color:#aeb9c4}
      .sa-axis-band-name{position:absolute;left:-128px;width:118px;top:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;text-align:right;font-size:8px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#687684;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sa-x-span{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;border-left:1px dashed rgba(160,174,188,.30);padding:0 3px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sa-axis-band.regime .sa-x-span{border-left:2px solid rgba(230,237,244,.78);font-weight:750;color:#d5dde5}
      .sa-x-title{text-align:center;font-size:10px;font-weight:800;letter-spacing:.14em;color:#596675;margin-top:6px}
      @media(max-width:900px){.sa-axis-band-name{left:-104px;width:96px}.sa-y-span,.sa-x-span{font-size:8px}}
    `;document.head.appendChild(s);
  }
  function render(surface){
    const maprow=document.querySelector('.maprow'),yside=document.querySelector('.yside'),xaxis=document.querySelector('.xaxis'),sub=document.querySelector('.sub'),paths=document.querySelectorAll('.anatomy .path');
    if(!maprow||!yside||!xaxis)return;
    if(!surface?.semanticDescriptor){plans=null;yside.classList.add('sa-yaxis');yside.style.gridTemplateColumns='22px 1fr';yside.innerHTML='<div class="axis-title">Y PARAMETERS</div>';xaxis.style.marginLeft='126px';xaxis.innerHTML='<div class="sa-x-title">X PARAMETERS</div>';return;}
    const d=surface.semanticDescriptor,xItems=surface.semanticAxis?.x||[],yItems=surface.semanticAxis?.y||[],rect=canvas.getBoundingClientRect(),xPlan=choose(d,'x',xItems,Math.max(600,rect.width)),yPlan=choose(d,'y',yItems,Math.max(480,rect.height));plans={x:xPlan,y:yPlan};
    const sideWidth=Math.min(210,70+yPlan.length*46);maprow.style.gridTemplateColumns=`${sideWidth}px 1fr`;xaxis.style.marginLeft=`${sideWidth+10}px`;
    if(sub)sub.textContent=`${pretty(d.study_id)} · ${(surface.rows*surface.cols).toLocaleString()} configs · ${surface.rows.toLocaleString()} × ${surface.cols.toLocaleString()}`;
    if(paths[0])paths[0].textContent=(d.layout.y_parameter_order||[]).map(id=>defsById(d)[id]?.label||id).join(' → ');
    if(paths[1])paths[1].textContent=(d.layout.x_parameter_order||[]).map(id=>defsById(d)[id]?.label||id).join(' → ');
    yside.classList.add('sa-yaxis');yside.style.gridTemplateColumns=`22px repeat(${Math.max(1,yPlan.length)},minmax(42px,1fr))`;yside.innerHTML='<div class="axis-title">OUTER / STUDY</div>';
    for(const p of yPlan){const level=document.createElement('div');level.className='sa-y-level '+(p.role==='regime'?'regime':'');level.innerHTML=`<div class="sa-y-level-name" title="${p.name}">${shortName(p.name)}</div>`;for(const r of p.runs){if(!r.key)continue;const top=r.start/yItems.length*100,height=(r.end-r.start)/yItems.length*100,px=(r.end-r.start)/yItems.length*Math.max(480,rect.height),show=px>=14;const el=document.createElement('div');el.className='sa-y-span';el.style.top=`${top}%`;el.style.height=`${height}%`;el.title=`${p.name}: ${r.label}`;el.textContent=show?r.label:'';level.appendChild(el);}yside.appendChild(level);}
    xaxis.innerHTML='';for(const p of xPlan){const band=document.createElement('div');band.className='sa-axis-band '+(p.role==='regime'?'regime':'');band.innerHTML=`<div class="sa-axis-band-name" title="${p.name}">${shortName(p.name)}</div>`;for(const r of p.runs){if(!r.key)continue;const left=r.start/xItems.length*100,width=(r.end-r.start)/xItems.length*100,px=(r.end-r.start)/xItems.length*Math.max(600,rect.width),show=px>=34;const el=document.createElement('div');el.className='sa-x-span';el.style.left=`${left}%`;el.style.width=`${width}%`;el.title=`${p.name}: ${r.label}`;el.textContent=show?r.label:'';band.appendChild(el);}xaxis.appendChild(band);}const title=document.createElement('div');title.className='sa-x-title';title.textContent='INNER / TRADE MANAGEMENT';xaxis.appendChild(title);
  }
  function drawGuides(){
    if(!plans||!activeSurface?.semanticDescriptor)return;const rows=activeSurface.rows,cols=activeSurface.cols,d=devicePixelRatio||1,sx=canvas.width/cols,sy=canvas.height/rows;ctx.save();
    for(const p of plans.x)for(const r of p.runs)if(r.start>0&&r.key)vline(r.start,sx,d,p.role==='regime'?'hard':'minor');
    for(const p of plans.y)for(const r of p.runs)if(r.start>0&&r.key)hline(r.start,sy,d,p.role==='regime'?'hard':'minor');
    ctx.restore();
  }
  function install(){
    if(installed)return;
    if(!root.SurfacePackageV021||typeof activateSurface!=='function'||typeof draw!=='function'||typeof hardReset!=='function'||typeof activeSurface==='undefined'){setTimeout(install,25);return;}
    installed=true;injectStyle();
    const baseActivate=activateSurface,baseDraw=draw,baseHardReset=hardReset;
    activateSurface=async function(surface,opt){const out=await baseActivate(surface,opt);render(activeSurface);draw();return out;};
    draw=function(){baseDraw();drawGuides();};
    hardReset=async function(){const out=await baseHardReset();render(null);return out;};
    if(activeSurface?.semanticDescriptor){render(activeSurface);draw();}
    const v=document.querySelector('.version');if(v)v.textContent='v022';
    root.AxisChromeV022={version:VERSION,render};
  }
  install();
})(typeof window!=='undefined'?window:globalThis);