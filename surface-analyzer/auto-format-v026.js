(function(root){
  'use strict';
  const VERSION='auto-format-v026',PREF='surface-analyzer-auto-format:v1',TRIGGER_RATIO=80,MAX_MOVES=2;
  let installed=false,reapplying=false;
  const defsById=d=>Object.fromEntries((d.parameters||[]).map(p=>[p.id,p]));
  const sameOrder=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const ratio=(r,c)=>Math.max(r,c)/Math.max(1,Math.min(r,c));
  function enabled(){const v=localStorage.getItem(PREF);return v==null?true:v==='1';}
  function setEnabled(v){localStorage.setItem(PREF,v?'1':'0');}
  function captureOriginal(surface){
    if(surface.autoFormatOriginalLayout)return surface.autoFormatOriginalLayout;
    const l=surface.semanticDescriptor?.layout||{};
    return {
      x_parameter_order:[...(l.x_parameter_order||[])],
      y_parameter_order:[...(l.y_parameter_order||[])],
      divider_presentation:(l.divider_presentation||[]).map(x=>({...x})),
      virtual_slots:(l.virtual_slots||[]).map(x=>({...x,parameters:[...(x.parameters||[])]}))
    };
  }
  function sigAt(surface,ids,pos){let s='';for(let i=0;i<ids.length;i++){if(i)s+='|';s+=surface.semanticParameterIndices[ids[i]]?.[pos]??-1;}return s;}
  function gridShape(surface,xOrder,yOrder){
    const n=surface.rows*surface.cols,x=new Set(),y=new Set();
    for(let p=0;p<n;p++){x.add(sigAt(surface,xOrder,p));y.add(sigAt(surface,yOrder,p));}
    const cols=x.size,rows=y.size;return {rows,cols,complete:rows*cols===n};
  }
  function combos(items,max){
    const out=[];
    const walk=(start,pick)=>{if(pick.length)out.push([...pick]);if(pick.length===max)return;for(let i=start;i<items.length;i++){pick.push(items[i]);walk(i+1,pick);pick.pop();}};
    walk(0,[]);return out;
  }
  function chooseLayout(surface,original){
    const base=gridShape(surface,original.x_parameter_order,original.y_parameter_order);
    if(!base.complete||ratio(base.rows,base.cols)<TRIGGER_RATIO)return {...base,x:[...original.x_parameter_order],y:[...original.y_parameter_order],moved:[]};
    const d=surface.semanticDescriptor,defs=defsById(d),large=base.rows>=base.cols?'y':'x',small=large==='y'?'x':'y',largeOrder=[...original[`${large}_parameter_order`]],smallOrder=[...original[`${small}_parameter_order`]],slotMembers=new Set((original.virtual_slots||[]).flatMap(s=>s.parameters||[]));
    const movable=largeOrder.filter(id=>defs[id]&&defs[id].topology_role!=='regime'&&!slotMembers.has(id));
    let best={score:Math.abs(Math.log(base.rows/base.cols)),rows:base.rows,cols:base.cols,x:[...original.x_parameter_order],y:[...original.y_parameter_order],moved:[]};
    for(const moved of combos(movable,MAX_MOVES)){
      const remain=largeOrder.filter(id=>!moved.includes(id));
      const movedOrdered=largeOrder.filter(id=>moved.includes(id));
      const nextSmall=[...movedOrdered,...smallOrder];
      const x=large==='y'?nextSmall:remain,y=large==='y'?remain:nextSmall;
      if(!x.length||!y.length)continue;
      const shape=gridShape(surface,x,y);if(!shape.complete)continue;
      const score=Math.abs(Math.log(shape.rows/shape.cols))+moved.length*.08;
      if(score<best.score)best={score,rows:shape.rows,cols:shape.cols,x,y,moved:movedOrdered};
    }
    return best;
  }
  function axisEntry(surface,ids,pos){
    const defs=defsById(surface.semanticDescriptor),sem={};
    for(const id of ids){const idx=surface.semanticParameterIndices[id]?.[pos]??-1;sem[id]=idx<0?'':defs[id]?.values?.[idx]??'';}
    return sem;
  }
  function remap(surface,xOrder,yOrder,original,autoInfo){
    const n=surface.rows*surface.cols,currentX=surface.semanticDescriptor.layout.x_parameter_order||[],currentY=surface.semanticDescriptor.layout.y_parameter_order||[];
    if(sameOrder(currentX,xOrder)&&sameOrder(currentY,yOrder))return {...surface,autoFormatOriginalLayout:original,autoFormat:autoInfo};
    const xMap=new Map(),yMap=new Map(),xSig=new Array(n),ySig=new Array(n);
    for(let p=0;p<n;p++){
      const xs=sigAt(surface,xOrder,p),ys=sigAt(surface,yOrder,p);xSig[p]=xs;ySig[p]=ys;
      if(!xMap.has(xs))xMap.set(xs,{sig:xs,pos:p,rank:xOrder.map(id=>surface.semanticParameterIndices[id]?.[p]??-1)});
      if(!yMap.has(ys))yMap.set(ys,{sig:ys,pos:p,rank:yOrder.map(id=>surface.semanticParameterIndices[id]?.[p]??-1)});
    }
    const cmp=(a,b)=>{for(let i=0;i<a.rank.length;i++)if(a.rank[i]!==b.rank[i])return a.rank[i]-b.rank[i];return 0;};
    const x=[...xMap.values()].sort(cmp),y=[...yMap.values()].sort(cmp),cols=x.length,rows=y.length;
    if(rows*cols!==n)return surface;
    const xr=new Map(x.map((v,i)=>[v.sig,i])),yr=new Map(y.map((v,i)=>[v.sig,i])),metrics={},params={},seen=new Uint8Array(n);
    for(const [k,a] of Object.entries(surface.metrics||{}))metrics[k]=new Float64Array(n);
    for(const [k] of Object.entries(surface.semanticParameterIndices||{})){const a=new Int16Array(n);a.fill(-1);params[k]=a;}
    for(let old=0;old<n;old++){
      const pos=yr.get(ySig[old])*cols+xr.get(xSig[old]);if(seen[pos])return surface;seen[pos]=1;
      for(const [k,a] of Object.entries(surface.metrics||{}))metrics[k][pos]=a[old];
      for(const [k,a] of Object.entries(surface.semanticParameterIndices||{}))params[k][pos]=a[old];
    }
    const d=surface.semanticDescriptor,l=d.layout||{},divider=(original.divider_presentation||l.divider_presentation||[]).map(v=>({...v,axis:xOrder.includes(v.parameter)?'x':yOrder.includes(v.parameter)?'y':v.axis}));
    const descriptor={...d,layout:{...l,x_parameter_order:[...xOrder],y_parameter_order:[...yOrder],divider_presentation:divider}};
    const semanticAxis={x:x.map(v=>axisEntry(surface,xOrder,v.pos)),y:y.map(v=>axisEntry(surface,yOrder,v.pos))};
    return {...surface,rows,cols,metrics,semanticParameterIndices:params,semanticAxis,semanticDescriptor:descriptor,autoFormatOriginalLayout:original,autoFormat:autoInfo};
  }
  function format(surface,on){
    if(!surface?.semanticDescriptor?.layout||!surface.semanticParameterIndices)return surface;
    const original=captureOriginal(surface);
    if(!on)return remap(surface,original.x_parameter_order,original.y_parameter_order,original,{enabled:false,moved:[],rows:null,cols:null});
    const pick=chooseLayout(surface,original);
    return remap(surface,pick.x,pick.y,original,{enabled:true,moved:pick.moved,rows:pick.rows,cols:pick.cols});
  }
  function ensureToggle(){
    const controls=document.querySelector('.controls');if(!controls)return null;
    let wrap=document.getElementById('autoFormatControl');if(wrap)return wrap;
    wrap=document.createElement('div');wrap.id='autoFormatControl';wrap.className='ctrl';wrap.innerHTML='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:#cdd6df"><input id="autoFormatToggle" type="checkbox" style="margin:0"> Auto Format</label>';
    const axis=document.getElementById('axisLayerControl');controls.insertBefore(wrap,axis||controls.querySelector('.legend'));
    const cb=wrap.querySelector('#autoFormatToggle');cb.checked=enabled();cb.addEventListener('change',async()=>{setEnabled(cb.checked);if(typeof activeSurface==='undefined'||!activeSurface?.semanticDescriptor||reapplying)return;reapplying=true;try{await activateSurface(activeSurface);}finally{reapplying=false;}});
    return wrap;
  }
  function install(){
    if(installed)return;
    if(!root.AxisLayerControlsV023||typeof activateSurface!=='function'||typeof activeSurface==='undefined'){setTimeout(install,25);return;}
    installed=true;ensureToggle();
    const baseActivate=activateSurface;
    activateSurface=async function(surface,opt){return baseActivate(format(surface,enabled()),opt);};
    if(activeSurface?.semanticDescriptor&&!reapplying){reapplying=true;Promise.resolve(activateSurface(activeSurface)).finally(()=>{reapplying=false;});}
    const v=document.querySelector('.version');if(v)v.textContent='v026';
    root.SurfaceAutoFormatV026={version:VERSION,format,chooseLayout};
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
