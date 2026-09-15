(function(root){
  'use strict';
  const VERSION='surface-package-v019';
  const CSV_NAME='surface.semantic.csv';
  const DESCRIPTOR_NAME='surface_descriptor.json';
  const utf8=new TextDecoder('utf-8');

  function fail(msg){throw new Error(msg);}
  function readU16(view,off){return view.getUint16(off,true);}
  function readU32(view,off){return view.getUint32(off,true);}
  function findEocd(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),min=Math.max(0,bytes.length-22-65535);
    for(let i=bytes.length-22;i>=min;i--)if(readU32(view,i)===0x06054b50)return i;
    fail('ZIP end-of-central-directory record not found');
  }
  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined')fail('This browser does not support ZIP decompression.');
    const ds=new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzipSelected(file,wanted){
    const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),eocd=findEocd(bytes);
    const entries=readU16(view,eocd+10),centralOffset=readU32(view,eocd+16),out=new Map();let p=centralOffset;
    for(let n=0;n<entries;n++){
      if(readU32(view,p)!==0x02014b50)fail(`Invalid ZIP central-directory entry ${n+1}`);
      const flags=readU16(view,p+8),method=readU16(view,p+10),compressedSize=readU32(view,p+20),uncompressedSize=readU32(view,p+24),nameLen=readU16(view,p+28),extraLen=readU16(view,p+30),commentLen=readU16(view,p+32),localOffset=readU32(view,p+42);
      const name=utf8.decode(bytes.subarray(p+46,p+46+nameLen));
      if(wanted.has(name)){
        if(flags&1)fail(`${name}: encrypted ZIP entries are not supported`);
        if(readU32(view,localOffset)!==0x04034b50)fail(`${name}: invalid local ZIP header`);
        const localNameLen=readU16(view,localOffset+26),localExtraLen=readU16(view,localOffset+28),start=localOffset+30+localNameLen+localExtraLen,packed=bytes.subarray(start,start+compressedSize);
        let raw;if(method===0)raw=packed.slice();else if(method===8)raw=await inflateRaw(packed);else fail(`${name}: unsupported ZIP compression method ${method}`);
        if(raw.length!==uncompressedSize)fail(`${name}: expected ${uncompressedSize} bytes after decompression, got ${raw.length}`);
        out.set(name,raw);
      }
      p+=46+nameLen+extraLen+commentLen;
    }
    for(const name of wanted)if(!out.has(name))fail(`ZIP is missing ${name}`);
    return out;
  }

  function eachCsvRow(text,fn){
    let row=[],field='',quoted=false,rowNo=1;
    const emitField=()=>{row.push(field);field='';};
    const emitRow=()=>{emitField();fn(row,rowNo++);row=[];};
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}
        else field+=ch;
      }else if(ch==='"')quoted=true;
      else if(ch===',')emitField();
      else if(ch==='\n')emitRow();
      else if(ch!=='\r')field+=ch;
    }
    if(quoted)fail('Semantic CSV ends inside a quoted field');
    if(field.length||row.length)emitRow();
  }
  function scalarToken(v){return v==null?'':String(v);}
  function parseScalar(text,type){
    if(text==='')return null;
    if(type==='number'||type==='integer'||type==='boolean'||type==='enum'){
      const v=Number(text);if(!Number.isFinite(v))fail(`Invalid ${type} value ${JSON.stringify(text)}`);return v;
    }
    return text;
  }
  function sameScalar(a,b){if(a==null||a==='')return b==null||b==='';return typeof b==='number'?Number(a)===b:String(a)===String(b);}
  function activeWhen(rule,params){
    if(!rule||rule==='always')return true;
    if(rule.op==='eq')return sameScalar(params[rule.parameter],rule.value);
    if(rule.op==='in')return rule.values.some(v=>sameScalar(params[rule.parameter],v));
    if(rule.op==='and')return (rule.clauses||[]).every(c=>activeWhen(c,params));
    fail(`Unsupported active_when rule ${JSON.stringify(rule)}`);
  }
  function validateDescriptor(d){
    if(!d||d.descriptor_schema_version!==1)fail('surface_descriptor.json must use descriptor_schema_version 1');
    if(!d.study_id||!Array.isArray(d.parameters)||!d.layout||!d.results)fail('Descriptor is missing study_id, parameters, layout, or results');
    const ids=new Set();for(const p of d.parameters){if(!p.id||ids.has(p.id))fail(`Invalid or duplicate parameter id ${p.id}`);ids.add(p.id);if(!['regime','ordered','facet'].includes(p.topology_role))fail(`${p.id}: invalid topology_role`);if(!Array.isArray(p.values)||!p.values.length)fail(`${p.id}: declared values are required`);}
    for(const axis of ['x_parameter_order','y_parameter_order'])for(const id of d.layout[axis]||[])if(!ids.has(id))fail(`${axis}: unknown parameter ${id}`);
    if(!Array.isArray(d.results.metrics)||!d.results.metrics.length)fail('Descriptor must declare results.metrics');
    return d;
  }
  function makeValueMaps(d){
    return Object.fromEntries(d.parameters.map(p=>[p.id,new Map(p.values.map((v,i)=>[scalarToken(v),i]))]));
  }
  function axisSpec(d,axis){
    const order=[...(d.layout[`${axis}_parameter_order`]||[])],slots=(d.layout.virtual_slots||[]).filter(s=>s.axis===axis),members=new Set(slots.flatMap(s=>s.parameters||[])),after=new Map();
    for(const s of slots){const a=after.get(s.after)||[];a.push(s);after.set(s.after,a);}
    const spec=[];
    for(const id of order){if(!members.has(id))spec.push({kind:'parameter',id});for(const s of after.get(id)||[])spec.push({kind:'virtual',id:s.id,parameters:s.parameters||[]});}
    return spec;
  }
  function signature(row,ids){return ids.map(id=>`${id}=${row[id]??''}`).join('|');}
  function axisRank(row,spec,valueMaps){
    const out=[];
    for(const item of spec){
      if(item.kind==='parameter'){
        const raw=row[item.id]??'',m=valueMaps[item.id];out.push(raw===''?-1:(m?.get(raw)??1e9));
      }else{
        let rank=-1,active=0;
        for(let j=0;j<item.parameters.length;j++){
          const id=item.parameters[j],raw=row[id]??'';if(raw==='')continue;
          const found=valueMaps[id]?.get(raw);if(found===undefined)fail(`${id}: undeclared value ${raw}`);rank=found;active++;
        }
        if(active!==1)fail(`${item.id}: expected exactly one active parameter, got ${active}`);out.push(rank);
      }
    }
    return out;
  }
  function cmpRank(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;}

  function buildSemanticSurface(text,descriptor,file){
    const d=validateDescriptor(descriptor),params=d.parameters,valueMaps=makeValueMaps(d),paramIds=params.map(p=>p.id),xIds=d.layout.x_parameter_order||[],yIds=d.layout.y_parameter_order||[],xSpec=axisSpec(d,'x'),ySpec=axisSpec(d,'y'),metricIds=d.results.metrics;
    const required=['analysis_key',...paramIds,...metricIds],constants=d.experiment_constants||[];
    const compact=[],xUnique=new Map(),yUnique=new Map(),analysisKeys=new Set();let header=null,col=null,dataRows=0;
    eachCsvRow(text,(cells,rowNo)=>{
      if(!header){header=cells.map(x=>x.trim());col=Object.fromEntries(header.map((name,i)=>[name,i]));const missing=[...required,...constants.map(c=>c.id)].filter(k=>col[k]===undefined);if(missing.length)fail(`Semantic CSV missing required columns: ${missing.join(', ')}`);return;}
      if(cells.every(v=>v===''))return;
      dataRows++;const sem={},typed={};
      for(const p of params){const raw=cells[col[p.id]]??'';sem[p.id]=raw;typed[p.id]=parseScalar(raw,p.type);}
      for(const p of params){const on=activeWhen(p.active_when,typed),raw=sem[p.id];if(on&&raw==='')fail(`Row ${rowNo}: active parameter ${p.id} is blank`);if(!on&&raw!=='')fail(`Row ${rowNo}: inactive parameter ${p.id} must be blank`);if(raw!==''&&!valueMaps[p.id].has(raw))fail(`Row ${rowNo}: ${p.id}=${raw} is outside the declared domain`);}
      for(const c of constants){const raw=cells[col[c.id]]??'';if(raw===''||!sameScalar(raw,c.value))fail(`Row ${rowNo}: constant ${c.id}=${raw} does not match descriptor value ${c.value}`);}
      const analysisKey=cells[col.analysis_key]??'';if(!analysisKey)fail(`Row ${rowNo}: blank analysis_key`);if(analysisKeys.has(analysisKey))fail(`Row ${rowNo}: duplicate analysis_key ${analysisKey}`);analysisKeys.add(analysisKey);
      const metricValues=new Float64Array(metricIds.length);for(let i=0;i<metricIds.length;i++){const v=Number(cells[col[metricIds[i]]]);if(!Number.isFinite(v))fail(`Row ${rowNo}: invalid ${metricIds[i]}`);metricValues[i]=v;}
      const xs=signature(sem,xIds),ys=signature(sem,yIds);if(!xUnique.has(xs))xUnique.set(xs,{sig:xs,row:sem,rank:axisRank(sem,xSpec,valueMaps)});if(!yUnique.has(ys))yUnique.set(ys,{sig:ys,row:sem,rank:axisRank(sem,ySpec,valueMaps)});
      compact.push({xs,ys,sem,metrics:metricValues});
    });
    if(!header)fail('Semantic CSV is empty');
    if(d.provenance?.source_row_count!=null&&Number(d.provenance.source_row_count)!==dataRows)fail(`Descriptor provenance expects ${d.provenance.source_row_count} rows, got ${dataRows}`);
    const x=[...xUnique.values()].sort((a,b)=>cmpRank(a.rank,b.rank)),y=[...yUnique.values()].sort((a,b)=>cmpRank(a.rank,b.rank)),cols=x.length,rows=y.length;
    if(rows*cols!==dataRows)fail(`Semantic surface is not a complete rectangle: ${rows} × ${cols} != ${dataRows}`);
    if(typeof ROWS!=='undefined'&&typeof COLS!=='undefined'&&(rows!==ROWS||cols!==COLS))fail(`Current renderer expects ${ROWS} × ${COLS}; package resolves to ${rows} × ${cols}`);
    const xi=new Map(x.map((v,i)=>[v.sig,i])),yi=new Map(y.map((v,i)=>[v.sig,i])),metrics=Object.fromEntries(metricIds.map(k=>[k,new Float64Array(dataRows)])),parameterIndices=Object.fromEntries(paramIds.map(k=>{const a=new Int16Array(dataRows);a.fill(-1);return[k,a];})),seen=new Uint8Array(dataRows);
    for(const rec of compact){const px=xi.get(rec.xs),py=yi.get(rec.ys),i=py*cols+px;if(seen[i])fail(`Duplicate visual cell y=${py} x=${px}`);seen[i]=1;for(let m=0;m<metricIds.length;m++)metrics[metricIds[m]][i]=rec.metrics[m];for(const p of params){const raw=rec.sem[p.id];if(raw!=='')parameterIndices[p.id][i]=valueMaps[p.id].get(raw);}}
    if(seen.some(v=>v!==1))fail('Semantic package does not cover every resolved visual cell');
    for(const k of (typeof METRICS!=='undefined'?METRICS:metricIds))if(!metrics[k])fail(`Analyzer-required metric ${k} is not declared by this package`);
    return {schemaVersion:2,packageVersion:VERSION,packageKind:'semantic-surface-v1',fileName:file.name||'surface.surface.zip',fileSize:file.size||0,loadedAt:new Date().toISOString(),rows,cols,jobId:d.provenance?.job_id??null,runId:d.provenance?.run_id??null,generationId:d.provenance?.data_generation_id??null,buildId:d.provenance?.backtester_build??null,metrics,semanticDescriptor:d,semanticParameterIndices:parameterIndices,semanticAxis:{xSignatures:x.map(v=>v.sig),ySignatures:y.map(v=>v.sig)}};
  }

  async function loadPackage(file){
    const files=await unzipSelected(file,new Set([CSV_NAME,DESCRIPTOR_NAME]));
    const descriptor=JSON.parse(utf8.decode(files.get(DESCRIPTOR_NAME))),csvText=utf8.decode(files.get(CSV_NAME));
    return buildSemanticSurface(csvText,descriptor,file);
  }
  async function onCaptureChange(e){
    const input=e.currentTarget,file=input.files?.[0];if(!file||!(/\.zip$/i.test(file.name)))return;
    e.stopImmediatePropagation();loading.style.display='flex';loading.textContent=`Opening ${file.name}…`;uploadBtn.disabled=true;hardResetBtn.disabled=true;
    try{const surface=await loadPackage(file);await activateSurface(surface,{persist:true});statusEl.textContent=`${file.name} loaded · semantic package · ${surface.rows*surface.cols} configs · saved locally until Hard Reset`;}
    catch(err){loading.style.display='flex';loading.textContent='Invalid surface package: '+err.message;statusEl.textContent='Surface package rejected';console.error(err);}
    finally{uploadBtn.disabled=false;hardResetBtn.disabled=false;input.value='';}
  }
  function install(){
    if(typeof csvFile==='undefined'||!csvFile||typeof activateSurface!=='function'){setTimeout(install,25);return;}
    csvFile.accept='.surface.zip,.zip,.csv,text/csv,application/zip';uploadBtn.textContent='Upload Surface';csvFile.addEventListener('change',onCaptureChange,true);
    const v=document.querySelector('.version');if(v)v.textContent='v019';
    root.SurfacePackageV019={version:VERSION,loadPackage,buildSemanticSurface};
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
