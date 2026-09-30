const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const API={analyze:'/api/analyze',process:'/api/process'};

const ui={
  ar:['العربية','rtl'],
  en:['English','ltr'],
  fr:['Français','ltr'],
  es:['Español','ltr'],
  de:['Deutsch','ltr'],
  tr:['Türkçe','ltr'],
  pt:['Português','ltr'],
  it:['Italiano','ltr'],
  zh:['中文','ltr'],
  ja:['日本語','ltr'],
  ko:['한국어','ltr'],
  ru:['Русский','ltr']
};

const sub={
  ar:'العربية',
  en:'English',
  fr:'Français',
  es:'Español',
  de:'Deutsch',
  tr:'Türkçe',
  pt:'Português',
  it:'Italiano',
  zh:'中文',
  ja:'日本語',
  ko:'한국어',
  ru:'Русский'
};

const dict={
  ar:{
    features:'المميزات',
    workflow:'كيف يعمل',
    studio:'الاستوديو',
    heroTitle:'حوّل رابط BiliBili<br><em>إلى Reels جاهزة.</em>',
    heroDesc:'ألصق الرابط، اختر التقسيم والترجمة والـBranding، ثم ابدأ المعالجة من المصدر مباشرة.',
    start:'ابدأ الآن ↓',
    how:'شاهد الطريقة',
    fast:'سريع',
    organized:'منظم',
    sourceTitle:'رابط BiliBili',
    analyze:'تحليل',
    sourceHint:'لا يوجد رفع فيديو من الهاتف أو الكمبيوتر.\nالمصدر هو رابط BiliBili فقط.',
    requestTitle:'هندسة الطلب',
    quality:'الجودة',
    subtitles:'الترجمة',
    enableSubs:'إنشاء Subtitles',
    split:'التقسيم',
    custom:'مخصص',
    smart:'دع الذكاء الاصطناعي يقترح المقاطع المهمة.',
    create:'إنشاء Reels →',
    result:'النتيجة',
    zip:'تحميل الكل كـ ZIP',
    f1:'لا Upload للفيديو. الصق الرابط فقط.',
    f2:'تقسيم ثابت أو اختيار ذكي للمقاطع.',
    f3:'ترجمة واختيار لغة الإخراج.',
    f4:'Logo وإعدادات إخراج منظمة.'
  },

  en:{
    features:'Features',
    workflow:'How it works',
    studio:'Studio',
    heroTitle:'Turn a BiliBili URL<br><em>into ready Reels.</em>',
    heroDesc:'Paste the URL, choose splitting, subtitles and branding, then process directly from the source.',
    start:'Start now ↓',
    how:'How it works',
    fast:'Fast',
    organized:'Organized',
    sourceTitle:'BiliBili URL',
    analyze:'Analyze',
    sourceHint:'No video upload from your phone or computer.\nThe source is a BiliBili URL.',
    requestTitle:'Request Designer',
    quality:'Quality',
    subtitles:'Subtitles',
    enableSubs:'Create subtitles',
    split:'Splitting',
    custom:'Custom',
    smart:'Let AI suggest important clips.',
    create:'Create Reels →',
    result:'Results',
    zip:'Download all as ZIP',
    f1:'No video upload. Paste the URL.',
    f2:'Fixed splitting or AI clip selection.',
    f3:'Translation and output language.',
    f4:'Logo and organized output settings.'
  },

  fr:{
    features:'Fonctions',
    workflow:'Comment ça marche',
    studio:'Studio',
    heroTitle:'Transformez une URL BiliBili<br><em>en Reels prêtes.</em>',
    heroDesc:'Collez l’URL, choisissez le découpage, les sous-titres et le branding, puis lancez le traitement.',
    start:'Commencer ↓',
    how:'Comment ça marche',
    fast:'Rapide',
    organized:'Organisé',
    sourceTitle:'URL BiliBili',
    analyze:'Analyser',
    sourceHint:'Aucun upload vidéo.\nLa source est une URL BiliBili.',
    requestTitle:'Concepteur de requête',
    quality:'Qualité',
    subtitles:'Sous-titres',
    enableSubs:'Créer les sous-titres',
    split:'Découpage',
    custom:'Personnalisé',
    smart:'Laissez l’IA proposer les meilleurs extraits.',
    create:'Créer les Reels →',
    result:'Résultats',
    zip:'Télécharger tout en ZIP',
    f1:'Pas d’upload vidéo. Collez l’URL.',
    f2:'Découpage fixe ou sélection IA.',
    f3:'Traduction et langue de sortie.',
    f4:'Logo et réglages de sortie.'
  }
};

let lang=localStorage.getItem('br-ui-lang');

if(!ui[lang]){
  lang=(navigator.languages||[navigator.language||'en'])
    .map(x=>x.split('-')[0])
    .find(x=>ui[x])||'en';
}

const state={
  sourceUrl:'',
  source:null,
  quality:'720p',
  duration:30,
  smart:true,
  subs:true,
  subLang:'ar',
  logoUrl:'',
  logoPosition:'top-right',
  logoSize:28,
  logoOpacity:90,
  job:null,
  poll:null
};

function applyLang(){
  document.documentElement.lang=lang;
  document.documentElement.dir=ui[lang][1];

  $('#uiLanguage').innerHTML=Object.entries(ui)
    .map(([k,v])=>`<option value="${k}">${v[0]}</option>`)
    .join('');

  $('#uiLanguage').value=lang;

  $('#language').innerHTML=Object.entries(sub)
    .map(([k,v])=>`<option value="${k}">${v}</option>`)
    .join('');

  $('#language').value=state.subLang;

  const d=dict[lang]||dict.en;

  $$('[data-i18n]').forEach(e=>{
    if(d[e.dataset.i18n])e.innerHTML=d[e.dataset.i18n];
  });
}

function toast(m){
  const e=$('#toast');
  e.textContent=m;
  e.classList.add('show');

  clearTimeout(window.__t);

  window.__t=setTimeout(
    ()=>e.classList.remove('show'),
    3200
  );
}

function time(v){
  v=Number(v);

  if(!Number.isFinite(v))return'—';

  v=Math.round(v);

  return v>=3600
    ?new Date(v*1000).toISOString().slice(11,19)
    :`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
}

function summary(){
  $('#processSummary').textContent=
    `${state.source?.bvid||'Source'} · ${state.duration}s · ${state.quality} · 9:16`+
    `${state.smart?' · AI':''}`+
    `${state.subs?' · '+state.subLang.toUpperCase():''}`;
}

$('#uiLanguage').onchange=e=>{
  lang=e.target.value;
  localStorage.setItem('br-ui-lang',lang);
  applyLang();
};

$('#language').onchange=e=>{
  state.subLang=e.target.value;
  summary();
};

$('#themeBtn').onclick=()=>{
  document.body.classList.toggle('light');
};

$('#analyzeForm').onsubmit=async e=>{
  e.preventDefault();

  const url=$('#videoUrl').value.trim();

  try{
    const u=new URL(url);

    if(
      !/(^|\.)bilibili\.com$/i.test(u.hostname)&&
      u.hostname.toLowerCase()!=='b23.tv'
    ){
      throw Error('Only BiliBili URLs are supported.');
    }
  }catch(x){
    return toast(x.message);
  }

  $('#analyzeBtn').disabled=true;
  $('#sourceStatus').textContent='● ANALYZING';
  $('#sourceStatus').className='status busy';

  try{
    const r=await fetch(
      `${API.analyze}?url=${encodeURIComponent(url)}`
    );

    const d=await r.json().catch(()=>({}));

    if(!r.ok)throw Error(d.error||'Analysis failed');

    state.sourceUrl=url;
    state.source=d;

    $('#sourceCard').classList.remove('hidden');
    $('#sourceThumb').src=d.thumbnail||'';
    $('#sourceTitle').textContent=d.title||'BiliBili Video';
    $('#sourceAuthor').textContent=d.author?`@${d.author}`:'';
    $('#sourceDuration').textContent=time(d.duration);
    $('#sourceBvid').textContent=d.bvid||d.id||'';
    $('#sourceMessage').textContent=d.message||'Ready';

    $('#sourceStatus').textContent='● READY';
    $('#sourceStatus').className='status ready';

    $('#workspace').classList.remove('hidden');

    summary();

    toast('Source analyzed.');
  }catch(x){
    $('#sourceStatus').textContent='● ERROR';
    $('#sourceStatus').className='status error';
    toast(x.message);
  }finally{
    $('#analyzeBtn').disabled=false;
  }
};

$$('.options,.split-options').forEach(g=>{
  g.onclick=e=>{
    const b=e.target.closest('.option');

    if(!b)return;

    g.querySelectorAll('.option')
      .forEach(x=>x.classList.remove('active'));

    b.classList.add('active');

    if(g.dataset.group==='quality'){
      state.quality=b.dataset.value;
    }else{
      const c=b.dataset.value==='custom';

      $('#customDurationWrap')
        .classList.toggle('hidden',!c);

      if(!c)state.duration=+b.dataset.value;
    }

    summary();
  };
});

$('#customDuration').oninput=e=>{
  state.duration=Math.max(
    10,
    Math.min(600,+e.target.value||10)
  );

  summary();
};

$('#subtitleToggle').onchange=e=>{
  state.subs=e.target.checked;
  summary();
};

$('#smartSplit').onchange=e=>{
  state.smart=e.target.checked;
  summary();
};

$('#logoUrl').oninput=e=>{
  state.logoUrl=e.target.value.trim();
};

$('#logoPosition').onchange=e=>{
  state.logoPosition=e.target.value;
};

$('#logoSize').oninput=e=>{
  $('#logoSizeValue').textContent=e.target.value+'%';
  state.logoSize=+e.target.value;
};

$('#logoOpacity').oninput=e=>{
  $('#logoOpacityValue').textContent=e.target.value+'%';
  state.logoOpacity=+e.target.value;
};

function showResult(){
  $('#result').classList.remove('hidden');

  $('#result').scrollIntoView({
    behavior:'smooth',
    block:'start'
  });
}

function prog(p,m){
  p=Math.max(
    0,
    Math.min(100,Math.round(p))
  );

  $('#progressBar').style.width=p+'%';
  $('#progressText').textContent=p+'%';

  if(m)$('#resultNote').textContent=m;
}

async function poll(id){
  clearInterval(state.poll);

  const check=async()=>{
    try{
      const r=await fetch(
        `${API.process}?jobId=${encodeURIComponent(id)}`
      );

      const d=await r.json().catch(()=>({}));

      if(!r.ok)throw Error(d.error||'Status failed');

      prog(
        (d.progress||0)*100,
        d.message
      );

      if(d.status==='completed'){
        clearInterval(state.poll);

        $('#resultStatus').textContent='✓ COMPLETE';
        $('#resultStatus').className='status ready';

        $('#reelsList').innerHTML=
          (d.reels||[])
          .map(x=>`
            <a
              class="reel"
              href="${x.url||'#'}"
              target="_blank"
              rel="noopener"
            >
              <strong>${x.filename}</strong>
              <small>${x.quality||state.quality} · 9:16</small>
              <span>↧</span>
            </a>
          `)
          .join('');

        $('#downloadAll').disabled=!d.zipUrl;

        if(d.zipUrl){
          $('#downloadAll').onclick=()=>{
            location.href=d.zipUrl;
          };
        }

        $('#processBtn').disabled=false;

        toast('Processing completed');

      }else if(d.status==='failed'){
        clearInterval(state.poll);

        $('#resultStatus').textContent='● ERROR';
        $('#resultStatus').className='status error';

        $('#processBtn').disabled=false;

        toast(d.error||'Processing failed');
      }

    }catch(x){
      clearInterval(state.poll);
      $('#processBtn').disabled=false;
      toast(x.message);
    }
  };

  await check();

  if(state.job===id){
    state.poll=setInterval(check,1500);
  }
}

$('#processBtn').onclick=async()=>{
  if(!state.source){
    return toast('Analyze a BiliBili URL first.');
  }

  showResult();

  prog(0,'Starting engine…');

  $('#resultStatus').textContent='● STARTING';
  $('#resultStatus').className='status busy';

  $('#processBtn').disabled=true;

  const body={
    sourceUrl:state.sourceUrl,

    bvid:
      state.source.bvid||
      state.source.id,

    quality:state.quality,

    split:{
      mode:state.smart?'ai':'fixed',
      duration:state.duration
    },

    subtitles:{
      enabled:state.subs,
      language:state.subLang
    },

    branding:{
      logoUrl:state.logoUrl||null,
      position:state.logoPosition,
      size:state.logoSize,
      opacity:state.logoOpacity
    },

    output:{
      aspect:'9:16',
      format:'mp4'
    }
  };

  try{
    const r=await fetch(
      API.process,
      {
        method:'POST',
        headers:{
          'content-type':'application/json'
        },
        body:JSON.stringify(body)
      }
    );

    const d=await r.json().catch(()=>({}));

    if(!r.ok){
      throw Error(
        d.error||
        'Could not start job'
      );
    }

    if(!d.jobId){
      throw Error(
        'Video engine did not return a jobId'
      );
    }

    state.job=d.jobId;

    poll(state.job);

  }catch(x){
    $('#resultStatus').textContent='● ERROR';
    $('#resultStatus').className='status error';

    $('#processBtn').disabled=false;

    toast(x.message);
  }
};

applyLang();
summary();
