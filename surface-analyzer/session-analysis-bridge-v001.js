(function(root,factory){
  const API=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceSessionAnalysisBridgeV001=API;
  if(typeof window!=='undefined')API.installBrowser();
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  const VERSION='session-analysis-bridge-v001';
  const DRIVER=/^(sr|fr):(.+)$/;
  const permutationCache=new WeakMap();

  function parameterIds(surface){
    return (surface?.semanticDescriptor?.parameters||[]).map(p=>p.id);
  }

  function assertCompatible(research,display,series){
    const n=research?.rows*research?.cols;
    if(!research?.semanticParameterIndices||!display?.semanticParameterIndices)throw new Error('Semantic parameter indices are required for analysis presentation.');
    if(!Number.isInteger(n)||n<=0||series?.length!==n)throw new Error('Analysis series does not match the research domain.');
    if(display.rows*display.cols!==n)throw new Error('Displayed surface and research domain contain different configuration counts.');
    const ids=parameterIds(research),displayIds=parameterIds(display);
    if(ids.length!==displayIds.length||ids.some((id,i)=>id!==displayIds[i]))throw new Error('Displayed surface descriptor does not match the research descriptor.');
    for(const id of ids){
      if(research.semanticParameterIndices[id]?.length!==n||display.semanticParameterIndices[id]?.length!==n)throw new Error(`${id}: semantic parameter array length mismatch.`);
    }
    return {n,ids};
  }

  function sameSemanticOrder(research,display,ids,n){
    for(const id of ids){
      const a=research.semanticParameterIndices[id],b=display.semanticParameterIndices[id];
      for(let i=0;i<n;i++)if(a[i]!==b[i])return false;
    }
    return true;
  }

  function tupleKey(arrays,ids,i){
    let key='';
    for(let k=0;k<ids.length;k++)key+=(k?',':'')+arrays[ids[k]][i];
    return key;
  }

  function buildPermutation(research,display){
    const {n,ids}=assertCompatible(research,display,{length:research.rows*research.cols});
    if(sameSemanticOrder(research,display,ids,n))return null;
    let byDisplay=permutationCache.get(research);
    if(!byDisplay){byDisplay=new WeakMap();permutationCache.set(research,byDisplay);}
    const cached=byDisplay.get(display);if(cached)return cached;
    const sourceByKey=new Map();
    for(let i=0;i<n;i++){
      const key=tupleKey(research.semanticParameterIndices,ids,i);
      if(sourceByKey.has(key))throw new Error(`Duplicate research semantic configuration ${key}`);
      sourceByKey.set(key,i);
    }
    const permutation=new Int32Array(n),seen=new Uint8Array(n);
    for(let i=0;i<n;i++){
      const key=tupleKey(display.semanticParameterIndices,ids,i),source=sourceByKey.get(key);
      if(source===undefined)throw new Error(`Displayed configuration ${key} is absent from the research domain.`);
      if(seen[source])throw new Error(`Displayed semantic configuration ${key} is duplicated.`);
      seen[source]=1;permutation[i]=source;
    }
    byDisplay.set(display,permutation);
    return permutation;
  }

  function remapSeries(research,display,series){
    const {n,ids}=assertCompatible(research,display,series);
    if(sameSemanticOrder(research,display,ids,n))return series;
    const permutation=buildPermutation(research,display),out=new series.constructor(n);
    for(let i=0;i<n;i++)out[i]=series[permutation[i]];
    return out;
  }

  function computeForDisplay(session,display,key){
    const match=DRIVER.exec(key||'');if(!match)return null;
    const [,kind,metric]=match,snapshot=session?.getAnalysisSnapshot?.(),research=snapshot?.researchSurface;
    if(!research)throw new Error('Canonical research domain is unavailable.');
    if(kind==='fr'){
      const full=session.computeFacetReplication(metric);
      return {kind,metric,full,values:remapSeries(research,display,full.facet_replication),topology:session.getAnalysisSnapshot().topology};
    }
    const full=session.computeStructuralRobustness(metric);
    return {kind,metric,full,values:remapSeries(research,display,full.structural_robustness),topology:session.getAnalysisSnapshot().topology};
  }

  function installBrowser(){
    let installed=false,lastSetMetric=null,stableTicks=0,tries=0;
    function ready(){
      return typeof setMetric==='function'&&typeof draw==='function'&&typeof meta!=='undefined'&&!!meta&&
        !!root.SurfaceSemanticAnalysisBrowserV030&&!!root.SurfaceAnalyzerBrowserSessionV001;
    }
    function install(){
      const baseSetMetric=setMetric;
      setMetric=async function(key){
        const match=DRIVER.exec(key||'');
        if(!match||!activeSurface?.semanticDescriptor)return baseSetMetric(key);
        const metric=match[2],isFr=match[1]==='fr',session=root.SurfaceAnalyzerBrowserSessionV001.getSession?.();
        if(!session)return baseSetMetric(key);
        currentKey=key;lastPerformanceKey=metric;if(!isFr)lastRobustnessKey=key;
        loading.style.display='flex';loading.textContent=`Calculating ${meta[metric]?.label||metric}…`;
        try{
          await new Promise(r=>setTimeout(r,0));
          const result=computeForDisplay(session,activeSurface,key),g=result.topology;
          values=result.values;currentStats=null;loading.style.display='none';
          if(isFr){
            const d=result.full.raw.diagnostics;
            statusEl.textContent=`Facet Replication · ${g.hardSurfaceCount} hard surfaces · ${g.info.facets.length} descriptor facets · ${d.missingExpectedPeers} missing expected peers · generic topology v030`;
          }else{
            statusEl.textContent=`Structural Robustness · ${g.hardSurfaceCount} hard surfaces · ${g.components.toLocaleString()} facet components · ${g.undirectedEdgeCount.toLocaleString()} semantic edges · generic topology v030`;
          }
          draw();
        }catch(e){
          loading.style.display='flex';loading.textContent=`Could not calculate ${isFr?'facet replication':'robustness'}: ${e.message}`;
          statusEl.textContent=`${isFr?'Facet Replication':'Structural Robustness'} failed`;
          console.error(e);
        }
      };
      root.dispatchEvent?.(new CustomEvent('surface-analyzer-session-analysis-ready',{detail:{version:VERSION}}));
      console.info('Surface Analyzer v1 SR/FR session bridge active');
    }
    function probe(){
      if(installed)return;
      if(!ready()){
        if(tries++<600)setTimeout(probe,25);else console.error('Surface Analyzer v1 SR/FR bridge: dependencies did not become ready.');
        return;
      }
      if(setMetric!==lastSetMetric){lastSetMetric=setMetric;stableTicks=0;setTimeout(probe,25);return;}
      if(++stableTicks<4){setTimeout(probe,25);return;}
      installed=true;install();
    }
    probe();
  }

  return {VERSION,remapSeries,computeForDisplay,installBrowser};
});
