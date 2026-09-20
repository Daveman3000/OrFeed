(function(root,factory){
  const API=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceSessionPackageBridgeV001=API;
  if(typeof document!=='undefined')API.install();
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  const VERSION='session-package-bridge-v001';
  const CSV_NAME='surface.semantic.csv';
  const DESCRIPTOR_NAME='surface_descriptor.json';
  const utf8=new TextDecoder('utf-8');
  const CSV_DECODE_CHUNK_BYTES=8*1024*1024;
  const fail=m=>{throw new Error(m);};
  const readU16=(v,o)=>v.getUint16(o,true);
  const readU32=(v,o)=>v.getUint32(o,true);

  function findEocd(bytes){
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),min=Math.max(0,bytes.length-65557);
    for(let i=bytes.length-22;i>=min;i--)if(readU32(v,i)===0x06054b50)return i;
    fail('ZIP end-of-central-directory record not found');
  }

  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined')fail('This browser does not support ZIP decompression.');
    const ds=new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }

  async function sha256Hex(bytes){
    if(!root.crypto?.subtle)fail('WebCrypto SHA-256 is unavailable.');
    const digest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes));
    return [...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
  }

  async function unzipSelected(file,wanted){
    const bytes=new Uint8Array(await file.arrayBuffer()),packageSha256=await sha256Hex(bytes),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),e=findEocd(bytes),entries=readU16(v,e+10),central=readU32(v,e+16),out=new Map();
    let p=central;
    for(let n=0;n<entries;n++){
      if(readU32(v,p)!==0x02014b50)fail(`Invalid ZIP central-directory entry ${n+1}`);
      const flags=readU16(v,p+8),method=readU16(v,p+10),cs=readU32(v,p+20),us=readU32(v,p+24),nl=readU16(v,p+28),el=readU16(v,p+30),cl=readU16(v,p+32),lo=readU32(v,p+42),name=utf8.decode(bytes.subarray(p+46,p+46+nl));
      if(wanted.has(name)){
        if(flags&1)fail(`${name}: encrypted ZIP entries are not supported`);
        if(readU32(v,lo)!==0x04034b50)fail(`${name}: invalid local ZIP header`);
        const lnl=readU16(v,lo+26),lel=readU16(v,lo+28),start=lo+30+lnl+lel,packed=bytes.subarray(start,start+cs);
        let raw;
        if(method===0)raw=packed.slice();
        else if(method===8)raw=await inflateRaw(packed);
        else fail(`${name}: unsupported ZIP compression method ${method}`);
        if(raw.length!==us)fail(`${name}: expected ${us} bytes after decompression, got ${raw.length}`);
        out.set(name,raw);
      }
      p+=46+nl+el+cl;
    }
    for(const name of wanted)if(!out.has(name))fail(`ZIP is missing ${name}`);
    out.packageSha256=packageSha256;
    return out;
  }

  function* decodeUtf8Chunks(bytes,chunkBytes=CSV_DECODE_CHUNK_BYTES){
    if(!Number.isInteger(chunkBytes)||chunkBytes<1)fail('CSV decode chunk size must be a positive integer');
    const decoder=new TextDecoder('utf-8');
    for(let offset=0;offset<bytes.length;offset+=chunkBytes){
      yield decoder.decode(bytes.subarray(offset,Math.min(bytes.length,offset+chunkBytes)),{stream:true});
    }
    const tail=decoder.decode();
    if(tail)yield tail;
  }

  async function loadPackage(file){
    const core=root.SurfacePackageCoreV001;
    if(!core?.buildSemanticSurfaceFromTextChunks)fail('Canonical Surface Package streaming core is unavailable.');
    const z=await unzipSelected(file,new Set([CSV_NAME,DESCRIPTOR_NAME]));
    const descriptorBytes=z.get(DESCRIPTOR_NAME);
    const csvBytes=z.get(CSV_NAME);
    const descriptor=JSON.parse(utf8.decode(descriptorBytes));
    const surface=core.buildSemanticSurfaceFromTextChunks(decodeUtf8Chunks(csvBytes),descriptor,file);
    surface.regionAnalyzerIdentity={
      packageSha256:z.packageSha256,
      descriptorSha256:await sha256Hex(descriptorBytes),
      semanticCsvSha256:await sha256Hex(csvBytes)
    };
    return surface;
  }

  function install(){
    if(document.documentElement.dataset.surfaceAnalyzerPackageBridge==='1')return;
    document.documentElement.dataset.surfaceAnalyzerPackageBridge='1';
    document.addEventListener('change',async e=>{
      const input=e.target;
      if(input?.id!=='csvFile')return;
      const file=input.files?.[0];
      if(!file||!/\.zip$/i.test(file.name))return;
      e.preventDefault();e.stopImmediatePropagation();
      const loadingEl=document.getElementById('loading'),upload=document.getElementById('uploadCsv'),reset=document.getElementById('hardReset'),status=document.getElementById('status');
      if(loadingEl){loadingEl.style.display='flex';loadingEl.textContent=`Opening ${file.name}…`;}
      if(upload)upload.disabled=true;if(reset)reset.disabled=true;
      try{
        const surface=await loadPackage(file);
        if(typeof activateSurface!=='function')fail('Surface activation is unavailable.');
        await activateSurface(surface,{persist:true});
        if(status)status.textContent=`${file.name} loaded · canonical semantic package · ${(surface.rows*surface.cols).toLocaleString()} configs · saved locally until Hard Reset`;
      }catch(error){
        if(loadingEl){loadingEl.style.display='flex';loadingEl.textContent='Invalid surface package: '+error.message;}
        if(status)status.textContent='Surface package rejected';
        console.error(error);
      }finally{
        if(upload)upload.disabled=false;if(reset)reset.disabled=false;input.value='';
      }
    },true);
  }

  return {VERSION,CSV_DECODE_CHUNK_BYTES,decodeUtf8Chunks,unzipSelected,loadPackage,install};
});
