(function(root,factory){
  const API=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceSessionRrBridgeV001=API;
  if(typeof window!=='undefined')API.loadPatchedPresenters();
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  const VERSION='session-rr-bridge-v001';
  const PRESENTATION='rr-presentation-v036.js?v=036';
  const LABELS='rr-fragment-labels-v037.js?v=037';
  const callbacks=new Set();
  let scheduled=false,sessionUnsubscribe=null,subscribedSession=null,displayHooked=false,lastActivate=null,stableTicks=0,tries=0;

  function session(){return root.SurfaceAnalyzerBrowserSessionV001?.getSession?.()||null;}

  function presentationState({sessionInstance=null,display=null,scanBridge=null}={}){
    const s=sessionInstance||session();
    const surface=display||(typeof activeSurface!=='undefined'?activeSurface:null);
    const bridge=scanBridge||root.SurfaceSessionScanBridgeV001;
    if(!s||!bridge?.getCurrentForDisplay)return null;
    const snapshot=s.getAnalysisSnapshot?.();
    const result=surface?.semanticDescriptor?bridge.getCurrentForDisplay(s,surface):null;
    return {result,config:snapshot?.scanConfig||{}};
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    const run=()=>{
      scheduled=false;
      for(const cb of [...callbacks]){try{cb();}catch(error){console.error('Surface Analyzer v1 RR presenter callback failed:',error);}}
    };
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(run);else setTimeout(run,0);
  }

  function bind(callback){
    if(typeof callback!=='function')return ()=>{};
    callbacks.add(callback);schedule();
    return ()=>callbacks.delete(callback);
  }

  function patchOnce(source,needle,replacement,label){
    const first=source.indexOf(needle),last=source.lastIndexOf(needle);
    if(first<0)throw new Error(`RR migration patch missing: ${label}`);
    if(first!==last)throw new Error(`RR migration patch is ambiguous: ${label}`);
    return source.slice(0,first)+replacement+source.slice(first+needle.length);
  }

  function patchPresentationSource(source){
    let out=source;
    out=patchOnce(out,
      "  function scanner(){return root.SurfaceScanLayerV035||root.SurfaceScanLayerV034||root.SurfaceScanLayerV033||null;}",
      "  function scanner(){return root.SurfaceSessionRrBridgeV001?.presentationState?.()||null;}",
      'RR presentation session source');
    out=patchOnce(out,
      "    setInterval(sync,200);sync();",
      "    root.SurfaceSessionRrBridgeV001?.bind?.(sync);sync();",
      'RR presentation event binding');
    out=patchOnce(out,
      "    installed=true;injectStyle();root.SurfaceRrPresentationV036={version:VERSION};",
      "    installed=true;injectStyle();root.SurfaceRrPresentationV036={version:VERSION,sync,forceSync:()=>{lastResult=null;lastMenuResult=null;sync();}};",
      'RR presentation forced repaint API');
    return out;
  }

  function patchLabelsSource(source){
    let out=source;
    out=patchOnce(out,
      "  function scanner(){return root.SurfaceScanLayerV035||root.SurfaceScanLayerV034||root.SurfaceScanLayerV033||null;}",
      "  function scanner(){return root.SurfaceSessionRrBridgeV001?.presentationState?.()||null;}",
      'RR labels session source');
    out=patchOnce(out,
      "    setInterval(drawExtraLabels,250);drawExtraLabels();",
      "    root.SurfaceSessionRrBridgeV001?.bind?.(()=>{root.SurfaceRrPresentationV036?.forceSync?.();drawExtraLabels();});root.SurfaceRrPresentationV036?.forceSync?.();drawExtraLabels();",
      'RR labels event binding');
    return out;
  }

  function inject(source){
    const script=document.createElement('script');script.textContent=source;document.head.appendChild(script);script.remove();
  }

  function hookRuntimeEvents(){
    if(displayHooked)return;
    if(typeof activateSurface!=='function'||typeof hardReset!=='function')return;
    displayHooked=true;
    const baseActivate=activateSurface,baseHardReset=hardReset;
    activateSurface=async function(...args){const out=await baseActivate(...args);schedule();return out;};
    hardReset=async function(...args){const out=await baseHardReset(...args);bindSession();schedule();return out;};
    document.getElementById('metric')?.addEventListener('change',schedule);
    document.addEventListener('click',e=>{if(e.target?.closest?.('#scanLayerControl'))schedule();},true);
    root.addEventListener?.('resize',schedule);
    const heat=document.getElementById('heat');
    if(heat&&typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(schedule);ro.observe(heat);root.__surfaceAnalyzerRrResizeObserver=ro;}
  }

  function bindSession(){
    const s=session();if(!s)return false;
    if(s!==subscribedSession){
      if(sessionUnsubscribe)sessionUnsubscribe();
      subscribedSession=s;sessionUnsubscribe=s.subscribe(()=>schedule());
    }
    return true;
  }

  function probeRuntime(){
    if(bindSession()){
      if(activateSurface!==lastActivate){lastActivate=activateSurface;stableTicks=0;displayHooked=false;setTimeout(probeRuntime,25);return;}
      if(++stableTicks<4){setTimeout(probeRuntime,25);return;}
      hookRuntimeEvents();schedule();return;
    }
    if(tries++<600)setTimeout(probeRuntime,25);else console.error('Surface Analyzer v1 RR bridge: session did not become ready.');
  }

  async function loadPatchedPresenters(){
    try{
      const [p,l]=await Promise.all([fetch(PRESENTATION,{cache:'no-store'}),fetch(LABELS,{cache:'no-store'})]);
      if(!p.ok)throw new Error(`RR presentation HTTP ${p.status}`);
      if(!l.ok)throw new Error(`RR labels HTTP ${l.status}`);
      inject(patchPresentationSource(await p.text()));
      inject(patchLabelsSource(await l.text()));
      probeRuntime();
      root.dispatchEvent?.(new CustomEvent('surface-analyzer-session-rr-ready',{detail:{version:VERSION}}));
      console.info('Surface Analyzer v1 RR presentation session bridge active');
    }catch(error){
      console.error('Surface Analyzer v1 RR bridge failed:',error);
      const el=typeof loading!=='undefined'?loading:null;
      if(el){el.style.display='flex';el.textContent='RR presentation bridge failed: '+error.message;}
    }
  }

  return {VERSION,presentationState,bind,schedule,patchPresentationSource,patchLabelsSource,loadPatchedPresenters};
});
