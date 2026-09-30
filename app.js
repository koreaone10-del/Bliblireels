const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const form = $('#analyzeForm');
const workspace = $('#workspace');
const result = $('#result');
const sourceTitle = $('#sourceTitle');
const sourceUrl = $('#sourceUrl');
const reelsList = $('#reelsList');
const progressBar = $('#progressBar');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#videoUrl').value.trim();
  if (!url) return;
  sourceTitle.textContent = 'Video source — ready for processing';
  sourceUrl.textContent = url;
  workspace.classList.remove('hidden');
  workspace.scrollIntoView({behavior:'smooth', block:'start'});
});

$$('.options, .split-options').forEach(group => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.option');
    if (!btn) return;
    group.querySelectorAll('.option').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
  });
});

$('#logoInput').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const label = e.target.closest('.upload');
  label.querySelector('span').textContent = '✓ ' + file.name;
});

$('#processBtn').addEventListener('click', async () => {
  result.classList.remove('hidden');
  reelsList.innerHTML = '';
  progressBar.style.width = '0%';
  result.scrollIntoView({behavior:'smooth', block:'start'});
  for (let p = 0; p <= 100; p += 10) {
    await new Promise(r => setTimeout(r, 120));
    progressBar.style.width = p + '%';
  }
  const split = document.querySelector('.split-options .active')?.dataset.value || '60';
  const count = split === '90' ? 18 : split === '120' ? 14 : 28;
  for (let i=1;i<=count;i++) {
    const item = document.createElement('div');
    item.className = 'reel';
    item.innerHTML = `<strong>DramaForAll_Reel_${String(i).padStart(3,'0')}.mp4</strong><small>9:16 · ${split === 'custom' ? 'Custom' : split + 's'} · READY</small>`;
    reelsList.appendChild(item);
  }
});

$('#downloadAll').addEventListener('click', () => {
  alert('نسخة الواجهة جاهزة. في المرحلة التالية نربط زر ZIP بمحرك المعالجة الحقيقي والـStorage.');
});

$('#themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('light');
});
