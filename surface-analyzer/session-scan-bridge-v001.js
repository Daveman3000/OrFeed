(function(root,factory){
  const API=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceSessionScanBridgeV001=API;
  if(typeof window!=='undefined')API.loadPatchedBrowserScan();
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  const VERSION='session-scan-bridge-v001';
  const LEGACY_SCAN='scan-layer-v033.js?v=035';

  function remapper(){
    const fn=root.SurfaceSessionAnalysisBridgeV001?.remapSeries;
    if(typeof fn!=='function')throw new Error('Session analysis remapper is unavailable.');
    return fn;
  }

  function remapScanResult(research,display,canonical,remap=remapper()){
    if(!canonical)return null;
    const out={...canonical};
    if(canonical.mask)out.mask=remap(research,display,canonical.mask);
    if(canonical.regionId)out.regionId=remap(research,display,canonical.regionId);
    if(canonical.performanceMask)out.performanceMask=remap(research,display,canonical.performanceMask);
    return out;
  }

  function remapRegional(research,display,canonical,remap=remapper()){
    if(!canonical)return null;
    return {
      ...canonical,
      mask:canonical.mask?remap(research,display,canonical.mask):canonical.mask,
      regionId:canonical.regionId?remap(research,display,canonical.regionId):canonical.regionId
    };
  }

  async function runForDisplay(session,display,config,{tau,remap}={}){
    if(!session?.runScan)throw new Error('Canonical Surface Analyzer session is unavailable.');
    const canonical=await session.runScan(config);
    const snapshot=session.getAnalysisSnapshot?.();
    const research=snapshot?.researchSurface;
    if(!research)throw new Error('Canonical research domain is unavailable.');
    let regional=null;
    if(config?.region_rules?.regional_robustness){
      if(!canonical.performanceMask)throw new Error('Regional Robustness requires at least one Performance criterion.');
      regional=session.runRegionalRobustness({
        minCells:Math.max(1,Math.trunc(Number(config.region_rules?.min_cells)||1)),
        metricIds:canonical.performanceMetrics,
        tau
      });
    }
    const out=remapScanResult(research,display,canonical,remap||remapper());
    if(regional)out.regionalRobustness=remapRegional(research,display,regional,remap||remapper());
    delete out.performanceMask;
    return out;
  }

  function getCurrentForDisplay(session,display,{remap}={}){
    const snapshot=session?.getAnalysisSnapshot?.();
    if(!snapshot?.scanResult||!snapshot.researchSurface)return null;
    const map=remap||remapper();
    const out=remapScanResult(snapshot.researchSurface,display,snapshot.scanResult,map);
    if(snapshot.regionalRobustness)out.regionalRobustness=remapRegional(snapshot.researchSurface,display,snapshot.regionalRobustness,map);
    delete out.performanceMask;
    return out;
  }

  function session(){return root.SurfaceAnalyzerBrowserSessionV001?.getSession?.()||null;}
  function clearApplied(){const s=session();if(s?.clearScan)s.clearScan();}

  function patchOnce(source,needle,replacement,label){
    const first=source.indexOf(needle),last=source.lastIndexOf(needle);
    if(first<0)throw new Error(`Scan migration patch missing: ${label}`);
    if(first!==last)throw new Error(`Scan migration patch is ambiguous: ${label}`);
    return source.slice(0,first)+replacement+source.slice(first+needle.length);
  }

  function patchLegacySource(source){
    let out=source;
    out=patchOnce(out,
      "      e.stopPropagation();if(!activeSurface?.semanticDescriptor)return;\n      const id=surfaceIdentity(activeSurface);",
      "      e.stopPropagation();if(!activeSurface?.semanticDescriptor)return;\n      const opening=!wrap.classList.contains('open');if(opening){document.getElementById('surfaceFilterControl')?.classList.remove('open');document.getElementById('axisLayerControl')?.classList.remove('open');}\n      const id=surfaceIdentity(activeSurface);",
      'scan menu mutual exclusion');
    out=patchOnce(out,
      "    clear.addEventListener('click',e=>{e.stopPropagation();clearActive();});",
      "    clear.addEventListener('click',e=>{e.stopPropagation();root.SurfaceSessionScanBridgeV001?.clearApplied?.();clearActive();});",
      'Clear Applied session invalidation');
    out=patchOnce(out,
      "    reset.addEventListener('click',e=>{e.stopPropagation();config=defaultConfig();draft=clone(config);saveConfig();clearActive();draft.criteria.push(defaultCriterion());renderMenu(false);});",
      "    reset.addEventListener('click',e=>{e.stopPropagation();root.SurfaceSessionScanBridgeV001?.clearApplied?.();config=defaultConfig();draft=clone(config);saveConfig();clearActive();draft.criteria.push(defaultCriterion());renderMenu(false);});",
      'Reset session invalidation');
    out=patchOnce(out,
      "    await new Promise(r=>setTimeout(r,0));\n    const g=ensureGraph();",
      "    await new Promise(r=>setTimeout(r,0));\n    const session=root.SurfaceAnalyzerBrowserSessionV001?.getSession?.();\n    if(session&&root.SurfaceSessionScanBridgeV001?.runForDisplay){\n      const r=await root.SurfaceSessionScanBridgeV001.runForDisplay(session,surface,config,{tau:root.SurfaceSemanticAnalysisV030?.TAU||DEFAULT_TAU});\n      if(activeSurface!==surface)throw new Error('Surface changed while scan was running. Apply again.');\n      result=r;resultSurface=surface;renderOverlay();updateControl();return;\n    }\n    const g=ensureGraph();",
      'session-owned scan execution');
    out=patchOnce(out,
      "    if(result&&resultSurface!==surface){clearActive();clearCaches();}",
      "    if(result&&resultSurface!==surface){const session=root.SurfaceAnalyzerBrowserSessionV001?.getSession?.(),next=session&&root.SurfaceSessionScanBridgeV001?.getCurrentForDisplay?.(session,surface);if(next){result=next;resultSurface=surface;renderOverlay();}else clearActive();clearCaches();}",
      'presentation remap after display reorder');
    return out;
  }

  function installPeerMenuRule(){
    const scan=()=>document.getElementById('scanLayerControl');
    for(const id of ['surfaceFilterControl','axisLayerControl']){
      const wrap=document.getElementById(id),btn=wrap?.querySelector('button');
      if(btn&&!btn.dataset.scanPeerRule){
        btn.dataset.scanPeerRule='1';
        btn.addEventListener('click',()=>scan()?.classList.remove('open'),true);
      }
    }
  }

  async function loadPatchedBrowserScan(){
    if(root.SurfaceScanLayerV035)return;
    try{
      const response=await fetch(LEGACY_SCAN,{cache:'no-store'});
      if(!response.ok)throw new Error(`legacy Scan Layer HTTP ${response.status}`);
      const patched=patchLegacySource(await response.text());
      const script=document.createElement('script');script.textContent=patched;document.head.appendChild(script);script.remove();
      installPeerMenuRule();
      root.dispatchEvent?.(new CustomEvent('surface-analyzer-session-scan-ready',{detail:{version:VERSION}}));
      console.info('Surface Analyzer v1 Scan Layer session bridge active');
    }catch(error){
      console.error('Surface Analyzer v1 Scan Layer bridge failed:',error);
      const el=typeof loading!=='undefined'?loading:null;
      if(el){el.style.display='flex';el.textContent='Scan Layer bridge failed: '+error.message;}
    }
  }

  return {VERSION,remapScanResult,remapRegional,runForDisplay,getCurrentForDisplay,clearApplied,patchLegacySource,installPeerMenuRule,loadPatchedBrowserScan};
});
