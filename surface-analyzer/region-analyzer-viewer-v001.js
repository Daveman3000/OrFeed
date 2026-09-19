(function(root){
  'use strict';
  if(typeof window==='undefined')return;

  const VERSION='region-analyzer-viewer-v001';
  const CATALOG_URL='region-analyzer/catalog.json';
  const HIDDEN_KEY='surface-analyzer:region-analyzer:hidden-v1';
  const COLORS=['#39d98a','#6aa9ff','#f2b84b','#e879f9','#ff7a90','#63d6e8','#b6e35c','#c4a7ff'];

  let installed=false,catalog=null,activeManifest=null,activeManifestUrl='',activeVersion=null,bundleBytes=null;
  let compatible=[],stage='6',stage4From=1,stage4To=20,stage6View='all',weightChoice='center',dimOutside=true;
  let visibleIds=[],enabledIds=new Set(),overlayCanvas=null,overlayCentroids=[],overlaySurface=null,mappingCache=null;
  let drawBase=null,activateBase=null,resetBase=null,rebuildToken=0;

  const $=s=>document.querySelector(s);
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const rungNum=r=>{const n=Number(String(r||'').replace(/^P/i,''));return Number.isFinite(n)?n:0;};
  const shortBand=v=>v==='STRONG'?'S':v==='MODERATE'?'M':v==='SENSITIVE'||v==='WEAK'?'W':v==='ADEQUATE'?'A':v||'â€”';

  function hiddenSet(){try{return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY)||'[]'));}catch{return new Set();}}
  function saveHidden(set){localStorage.setItem(HIDDEN_KEY,JSON.stringify([...set].sort()));}
  function session(){return root.SurfaceAnalyzerBrowserSessionV001?.getSession?.()||null;}
  function sourceSurface(){return session()?.getSourceSurface?.()||((typeof activeSurface!=='undefined')?activeSurface:null);}
  function currentSurface(){return (typeof activeSurface!=='undefined')?activeSurface:null;}
  function packageSha(surface){return surface?.regionAnalyzerIdentity?.packageSha256||'';}
  function descriptorSha(surface){return surface?.regionAnalyzerIdentity?.descriptorSha256||'';}

  async function sha256Hex(data){
    const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
    if(!root.crypto?.subtle)throw new Error('WebCrypto SHA-256 is unavailable.');
    const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
    return [...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  async function fetchText(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.text();}
  async function fetchJsonVerified(url,expectedSha=''){
    const text=await fetchText(url);
    if(expectedSha){const got=await sha256Hex(text);if(got!==expectedSha)throw new Error(`Manifest hash mismatch: expected ${expectedSha}, got ${got}`);}
    return JSON.parse(text);
  }
  async function loadCatalog(){if(catalog)return catalog;catalog=await fetch(CATALOG_URL,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`Catalog HTTP ${r.status}`);return r.json();});return catalog;}
  function manifestUrl(entry){return new URL(`region-analyzer/${entry.manifest_path}`,location.href).href;}
  function bundleUrl(manifest,url){return new URL(manifest.mask_bundle.path,url).href;}

  function injectStyle(){
    if($('#regionAnalyzerStyle'))return;
    const s=document.createElement('style');s.id='regionAnalyzerStyle';s.textContent=`
      .ra-wrap{position:relative}.ra-btn.active{box-shadow:inset 0 0 0 1px #7398bd;color:#fff}.ra-pop{display:none;position:absolute;right:0;top:38px;z-index:95;width:410px;max-width:min(94vw,410px);max-height:74vh;overflow:auto;background:#111821;border:1px solid #34404d;border-radius:10px;box-shadow:0 18px 46px #000b;padding:11px}.ra-wrap.open .ra-pop{display:block}.ra-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px}.ra-title{font-size:12px;font-weight:800}.ra-small{font-size:9px;color:#72808e}.ra-row{display:flex;align-items:center;gap:7px;margin:7px 0}.ra-row label{font-size:10px;color:#8f9baa}.ra-row select,.ra-row input[type=number]{background:#0d141c;color:#edf2f7;border:1px solid #33404d;border-radius:6px;padding:5px 6px;font:inherit;font-size:10px}.ra-row select{min-width:130px}.ra-stage,.ra-view{display:flex;gap:4px;flex-wrap:wrap}.ra-stage button,.ra-view button,.ra-action{border:0;border-radius:6px;background:#26313d;color:#aab6c2;font:inherit;font-size:10px;font-weight:750;padding:6px 8px;cursor:pointer}.ra-stage button.on,.ra-view button.on{background:#486783;color:#fff}.ra-action.subtle{background:transparent;color:#7f8d9a;padding:4px 6px}.ra-action.subtle:hover{color:#dfe7ef;background:#202a35}.ra-sep{border-top:1px solid #26313d;margin:9px 0}.ra-regions{display:grid;gap:4px;max-height:210px;overflow:auto}.ra-region{display:grid;grid-template-columns:18px 1fr auto;gap:6px;align-items:center;padding:5px 6px;border-radius:6px;background:#0d141c;font-size:9px;color:#b7c2cd}.ra-region b{color:#eef3f7}.ra-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.ra-empty{font-size:10px;color:#71808f;padding:7px 2px}.ra-error{font-size:9px;color:#e7a0a6;line-height:1.35}.ra-ok{font-size:9px;color:#83919f;line-height:1.35}.ra-controls-hidden{display:none!important}`;
    document.head.appendChild(s);
  }

  function ensureControl(){
    const controls=$('.controls');if(!controls)return null;
    let wrap=$('#regionAnalyzerControl');if(wrap)return wrap;
    wrap=document.createElement('div');wrap.id='regionAnalyzerControl';wrap.className='ctrl ra-wrap';wrap.style.display='none';
    wrap.innerHTML='<button class="ra-btn" type="button">Region Analyzer â–¾</button><div class="ra-pop"></div>';
    controls.insertBefore(wrap,controls.querySelector('.legend'));
    wrap.querySelector('.ra-btn').addEventListener('click',e=>{e.stopPropagation();wrap.classList.toggle('open');});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))wrap.classList.remove('open');});
    return wrap;
  }

  function verifyManifest(manifest,surface){
    if(!manifest?.surface||!surface)throw new Error('Region Analyzer surface identity is unavailable.');
    const pkg=packageSha(surface);if(!pkg)throw new Error('Loaded package has no verified SHA-256 identity. Reload it with the current v1 loader.');
    if(manifest.surface.package_sha256!==pkg)throw new Error('Region Analyzer package SHA does not match the loaded surface.');
    const ds=descriptorSha(surface);if(ds&&manifest.surface.descriptor_sha256!==ds)throw new Error('Region Analyzer descriptor SHA does not match the loaded surface.');
    if((surface.rows*surface.cols)!==manifest.surface.physical_cells)throw new Error('Region Analyzer physical cell count does not match the loaded package.');
    if(manifest.surface.domain_kind==='rectangular_physical_package'&&manifest.surface.cleaned_domain_mask?.kind!=='ALL_PHYSICAL_CELLS')throw new Error('Unexpected cleaned-domain contract.');
  }

  async function findCompatible(surface){
    const cat=await loadCatalog(),hidden=hiddenSet(),pkg=packageSha(surface);if(!pkg)return [];
    const out=[];
    for(const [surfaceId,group] of Object.entries(cat.surfaces||{})){
      for(const entry of group.versions||[]){
        if(hidden.has(entry.version_id))continue;
        const url=manifestUrl(entry);
        try{
          const manifest=await fetchJsonVerified(url,entry.content_sha256||'');
          if(manifest.surface?.package_sha256===pkg)out.push({surfaceId,entry,manifest,url});
        }catch(err){console.warn('Region Analyzer manifest skipped:',entry.version_id,err);}
      }
    }
    return out.sort((a,b)=>String(a.entry.version_id).localeCompare(String(b.entry.version_id)));
  }

  function versionLabel(item,index){
    const m=String(item.entry.version_id).match(/v(\d{3,})$/i);return m?`V {Number(m[1])}`:V ${index+1}`;
  }

  async function selectVersion(versionId){
    const item=compatible.find(v=>v.entry.version_id===versionId)||compatible.at(-1);if(!item)return;
    const src=sourceSurface();verifyManifest(item.manifest,src);
    const url=bundleUrl(item.manifest,item.url),r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Mask bundle HTTP ${r.status}`);
    const bytes=new Uint8Array(await r.arrayBuffer()),got=await sha256Hex(bytes);if(got!==item.manifest.mask_bundle.sha256)throw new Error(`Mask bundle hash mismatch: expected ${item.manifest.mask_bundle.sha256}, got ${got}`);
    if(bytes.length!==item.manifest.mask_bundle.bytes)throw new Error('Mask bundle byte length mismatch.');
    activeManifest=item.manifest;activeManifestUrl=item.url;activeVersion=item;bundleBytes=bytes;mappingCache=null;overlayCanvas=null;overlayCentroids=[];refreshSelection();renderMenu();
  }

  function stage4Ids(){
    const m=activeManifest;if(!m)return [];
    return (m.stages.stage4?.all_unique_lineage_envelopes||[]).filter(id=>{const p=rungNum(m.region_dictionary[id]?.rung);return p>=stage4From&&p<=stage4To;});
  }
  function stage5Ids(){
    const m=activeManifest;if(!m)return [];const a=m.stages.stage5?.annotations_by_region_id||{};return Object.keys(a).filter(id=>{const p=rungNum(m.region_dictionary[id]?.rung);return p>=stage4From&&p<=stage4To;});
  }
  function calibrationIds(role){
    const cal=activeManifest?.stages?.stage6?.calibration?.[role];if(!cal)return [];
    if(weightChoice==='stable')return cal.stable_intersection||[];
    if(weightChoice==='union')return cal.union||[];
    const runs=cal.runs||[],run=weightChoice==='center'?runs.find(x=>/CENTER/i.test(x.weight_id))||runs[0]:runs.find(x=>x.weight_id===weightChoice)||runs[0];
    return (run?.ranking||[]).filter(x=>x.rank<=3).sort((a,b)=>a.rank-b.rank
K›X\
Oœ™YÚ[Û—ÚY
NÂˆBˆ[˜İ[ÛˆİYÙM’YÊ
^ÂˆÛÛœİÏXXİ]™SX[šY™\İËœİYÙ\ÏËœİYÙMÚYŠ\Ê\™]\›ˆ×NÂˆYŠİYÙM•šY]ÏOOIİÜÜ\™›Ü›X[˜ÙIÊ\™]\›ˆØ[Xœ˜][Û’YÊ	Ü\™›Ü›X[˜ÙIÊNÂˆYŠİYÙM•šY]ÏOOIİÜÜİXš[]IÊ\™]\›ˆØ[Xœ˜][Û’YÊ	ÜİXš[]IÊNÂˆ™]\›ˆË˜ÛÛXİ[ÛœÏË–ÜİYÙM•šY]×_×NÂˆBˆ[˜İ[ÛˆÙ[XİYYÊ
^Ü™]\›ˆİYÙOOOIÍ	ÏÜİYÙMYÊ
NœİYÙOOOIÍIÏÜİYÙMRYÊ
NœİYÙM’YÊ
NßB‚ˆ[˜İ[Ûˆ˜[šÑ›ÜŠY›ÛJ^ÂˆÛÛœİØ[XXİ]™SX[šY™\İËœİYÙ\ÏËœİYÙMË˜Ø[Xœ˜][ÛË–Ü›ÛWNÚYŠXØ[
\™]\›ˆ[ÂˆÛÛœİ[œÏXØ[œ[œß×K[]ÙZYÚÚÚXÙOOOIØÙ[\‰ÏÜ[œË™š[™
O‹ĞÑS•T‹ÚK\İ
ÙZYÚÚY
J_[œÖÌNœ[œË™š[™
OÙZYÚÚYOO]ÙZYÚÚÚXÙJ_[œÖÌNÂˆ™]\›ˆ[Ëœ˜[šÚ[™ÏË™š[™
O