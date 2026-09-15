(function(){
  'use strict';

  function install(){
    const wrap=document.getElementById('scanLayerControl');
    if(!wrap||!window.SurfaceScanLayerV031){setTimeout(install,25);return;}
    const pop=wrap.querySelector('.sa-scan-pop'),button=wrap.querySelector('.sa-scan-btn');
    if(!pop||!button)return;

    const style=document.createElement('style');
    style.id='scanLayerUiV032Style';
    style.textContent=`
      .sa-scan-help{margin:-2px 0 10px;color:#8e9aa7;font-size:10px;line-height:1.4}
      .sa-scan-columns{display:grid;grid-template-columns:120px minmax(150px,1fr) 92px 62px 88px 28px;gap:6px;padding:0 0 4px;color:#697785;font-size:8px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
      @media(max-width:760px){.sa-scan-columns{display:none}}
    `;
    document.head.appendChild(style);

    let scheduled=false;
    function scheduleDecorate(){
      if(scheduled)return;
      scheduled=true;
      setTimeout(()=>{scheduled=false;decorate();},0);
    }

    function decorate(){
      if(!wrap.classList.contains('open'))return;
      const head=pop.querySelector('.sa-scan-head');
      if(head&&!pop.querySelector('.sa-scan-help')){
        const help=document.createElement('div');
        help.className='sa-scan-help';
        help.textContent='Keep configurations that pass every rule below. Each rule can use Performance, Structural Robustness, or Facet Replication.';
        head.insertAdjacentElement('afterend',help);
      }
      const master=pop.querySelector('.sa-scan-master');
      if(master){
        const text=[...master.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);
        if(text&&text.nodeValue!==' Enable scan overlay')text.nodeValue=' Enable scan overlay';
      }
      const section=[...pop.querySelectorAll('.sa-scan-section')].find(x=>x.textContent.includes('CRITERIA')||x.textContent.includes('RULES'));
      if(section&&section.textContent!=='MATCH ALL RULES')section.textContent='MATCH ALL RULES';
      const first=pop.querySelector('.sa-scan-row');
      if(first&&!pop.querySelector('.sa-scan-columns')){
        const h=document.createElement('div');
        h.className='sa-scan-columns';
        for(const t of ['Source','Metric','Basis','Rule','Threshold','']){
          const s=document.createElement('span');s.textContent=t;h.appendChild(s);
        }
        first.parentNode.insertBefore(h,first);
      }
      const apply=pop.querySelector('[data-act="apply"]');
      if(apply&&apply.textContent!=='Apply & Run')apply.textContent='Apply & Run';
    }

    // The menu rebuilds its contents while handling controls. Keep those clicks
    // inside the menu so the document-level outside-click handler cannot close it.
    pop.addEventListener('click',e=>{e.stopPropagation();scheduleDecorate();});
    pop.addEventListener('change',()=>scheduleDecorate());

    button.addEventListener('click',()=>setTimeout(()=>{
      if(!wrap.classList.contains('open'))return;
      if(!pop.querySelector('.sa-scan-row')){
        const add=pop.querySelector('.sa-scan-add');
        if(add)add.click();
      }
      decorate();
    },0));

    const v=document.querySelector('.version');
    if(v)v.textContent='v032';
  }
  install();
})();