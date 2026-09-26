/* =========================================================
   SIGAP-DM — app.js
   Semua data disimpan di localStorage (tanpa server/backend).
   Cocok untuk demo, skripsi, atau prototipe. Untuk penggunaan
   nyata lintas-perangkat (perawat mengakses dari HP sendiri,
   bukan dari HP pasien), lihat catatan di README tentang
   menghubungkan ke backend (mis. Firebase/Supabase).
   ========================================================= */

const DB_KEY = 'sigapdm_users';
const SESSION_KEY = 'sigapdm_session';

let currentUser = null;   // objek user pasien yang sedang login
let nurseSession = null;  // { name, code }

/* ---------------------------------------------------------
   Storage helpers
   --------------------------------------------------------- */
function loadUsers(){
  try{ return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
  catch(e){ return []; }
}
function saveUsers(users){
  localStorage.setItem(DB_KEY, JSON.stringify(users));
}
function findUserIndex(users, email){
  return users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
}
function persistCurrentUser(){
  const users = loadUsers();
  const idx = findUserIndex(users, currentUser.email);
  if(idx > -1){ users[idx] = currentUser; saveUsers(users); }
}
function getSession(){
  try{ return JSON.parse(localStorage.getItem(SESSION_KEY)); }
  catch(e){ return null; }
}
function setSession(s){ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }

function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function newUser(email, password){
  return {
    email, password,
    name: 'Pasien Baru', age: '', gender: 'Laki-laki', phone: '',
    familyName: '', familyPhone: '', nursePhone: '',
    shareWithFamily: false,
    darkMode: false,
    pin: null,
    glucose: [],
    meds: [],
    nurseNotes: []
  };
}

function ensureDemoUser(){
  const users = loadUsers();
  if(findUserIndex(users, 'demo@sigapdm.id') === -1){
    const u = newUser('demo@sigapdm.id', 'demo123');
    u.name = 'Dewi Anggraini';
    u.age = 58;
    u.gender = 'Perempuan';
    u.phone = '';
    const now = Date.now();
    u.glucose = [
      { id: uid(), value: 118, condition: 'sebelum makan', note: '', ts: now - 1000*60*60*24*3 },
      { id: uid(), value: 210, condition: 'sesudah makan', note: 'Habis makan nasi padang', ts: now - 1000*60*60*24*2 },
      { id: uid(), value: 95,  condition: 'sebelum makan', note: '', ts: now - 1000*60*60*24 },
      { id: uid(), value: 260, condition: 'sesudah makan', note: 'Pusing dan lemas', ts: now - 1000*60*30 }
    ];
    u.meds = [
      { id: uid(), name: 'Metformin', dose: '500mg', time: '07:00', takenDate: null },
      { id: uid(), name: 'Glimepiride', dose: '2mg', time: '19:00', takenDate: null }
    ];
    users.push(u);
    saveUsers(users);
  }
}

/* ---------------------------------------------------------
   Glucose classification (edukasi umum, bukan diagnosis medis)
   --------------------------------------------------------- */
function classifyGlucose(value, condition){
  if(value < 70){
    return { label: 'Rendah — Hipoglikemia', cls: 'badge-danger', level: 'danger' };
  }
  const highT = condition === 'sesudah makan' ? 180 : 130;
  const veryHighT = condition === 'sesudah makan' ? 250 : 200;
  if(value > veryHighT) return { label: 'Sangat Tinggi', cls: 'badge-danger', level: 'danger' };
  if(value > highT)     return { label: 'Tinggi',        cls: 'badge-warn',   level: 'warn'   };
  return { label: 'Normal', cls: 'badge-good', level: 'good' };
}

/* ---------------------------------------------------------
   WhatsApp helpers
   --------------------------------------------------------- */
function toWaNumber(phone){
  let digits = (phone || '').replace(/\D/g, '');
  if(!digits) return null;
  if(digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if(!digits.startsWith('62')) digits = '62' + digits;
  return digits;
}
function waLink(phone, message){
  const num = toWaNumber(phone);
  if(!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}
function lastGlucoseEntry(user){
  if(!user.glucose.length) return null;
  return [...user.glucose].sort((a,b)=>b.ts-a.ts)[0];
}
function buildFamilyReportMessage(user){
  const last = lastGlucoseEntry(user);
  const lastLine = last
    ? `Gula darah terakhir: ${last.value} mg/dL (${last.condition}), status: ${classifyGlucose(last.value,last.condition).label}.`
    : 'Belum ada data gula darah tercatat.';
  const medsLine = user.meds.length
    ? `Obat terdaftar: ${user.meds.map(m=>`${m.name} ${m.dose} (${m.time})`).join(', ')}.`
    : 'Belum ada obat terdaftar.';
  return `Halo, ini laporan kondisi ${user.name} dari aplikasi SIGAP-DM.\n\n${lastLine}\n${medsLine}\n\nDikirim otomatis pada ${new Date().toLocaleString('id-ID')}.`;
}
function buildEmergencyMessage(user, mapsLink){
  const last = lastGlucoseEntry(user);
  const lastLine = last
    ? `Gula darah terakhir: ${last.value} mg/dL (${classifyGlucose(last.value,last.condition).label}).`
    : 'Belum ada data gula darah.';
  const locLine = mapsLink ? `\n📍 Lokasi saat ini: ${mapsLink}` : '\n📍 Lokasi tidak dapat dideteksi otomatis — mohon konfirmasi lokasi lewat telepon.';
  return `🚨 DARURAT — ${user.name} membutuhkan bantuan segera.\n${lastLine}${locLine}\nMohon segera dihubungi atau didatangi.`;
}

/* ---------------------------------------------------------
   Geolocation — untuk berbagi lokasi saat darurat
   --------------------------------------------------------- */
let lastKnownLocation = null; // { lat, lng, accuracy, ts }

function requestLocationOnce(){
  return new Promise((resolve, reject) => {
    if(!('geolocation' in navigator)){
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now()
        };
        lastKnownLocation = loc;
        resolve(loc);
      },
      err => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
function mapsLinkFor(loc){
  return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
}

/* ---------------------------------------------------------
   Screen / navigation
   --------------------------------------------------------- */
function showTopScreen(id){
  document.querySelectorAll('#screen-login, #screen-pin, #screen-nurse').forEach(s => s.classList.remove('active-screen'));
  document.getElementById('app-shell').classList.remove('active-shell');
  if(id === 'app-shell'){
    document.getElementById('app-shell').classList.add('active-shell');
  } else {
    document.getElementById(id).classList.add('active-screen');
  }
}

function navigateApp(section){
  document.querySelectorAll('#app-shell .screen').forEach(s => s.classList.remove('active-screen'));
  document.getElementById('screen-' + section).classList.add('active-screen');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.goto === section));

  const titles = {
    dashboard: 'Dashboard', gula: 'Gula Darah', terapi: 'Terapi & Obat',
    edukasi: 'Edukasi', progress: 'Progress', profil: 'Profil'
  };
  document.getElementById('topbar-title').textContent = titles[section] || 'SIGAP-DM';

  if(section === 'progress') renderProgress();
  if(section === 'dashboard') renderDashboard();
}

/* ---------------------------------------------------------
   Dark mode
   --------------------------------------------------------- */
function applyDarkMode(on){
  document.body.classList.toggle('dark-mode', !!on);
  document.getElementById('btn-theme-toggle').textContent = on ? '☀️' : '🌙';
  const t = document.getElementById('toggle-dark');
  if(t) t.checked = !!on;
}

/* ---------------------------------------------------------
   Toast
   --------------------------------------------------------- */
let toastTimer = null;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.add('hidden'), 2600);
}

/* ---------------------------------------------------------
   Rendering — Dashboard
   --------------------------------------------------------- */
function renderDashboard(){
  const u = currentUser;
  document.getElementById('dash-name').textContent = u.name || 'Pasien';

  const last = lastGlucoseEntry(u);
  const lastVal = document.getElementById('dash-last-glucose');
  const lastStatus = document.getElementById('dash-last-status');
  if(last){
    const c = classifyGlucose(last.value, last.condition);
    lastVal.textContent = last.value + ' mg/dL';
    lastStatus.textContent = c.label;
    lastStatus.className = 'badge ' + c.cls;
  } else {
    lastVal.textContent = '-';
    lastStatus.textContent = 'Belum ada data';
    lastStatus.className = 'badge badge-neutral';
  }

  document.getElementById('dash-count-glucose').textContent = u.glucose.length;
  document.getElementById('dash-count-meds').textContent = u.meds.length;

  const takenToday = u.meds.filter(m => m.takenDate === todayStr()).length;
  document.getElementById('dash-meds-taken').textContent = `${takenToday}/${u.meds.length}`;

  // Critical alert banner
  const alertBox = document.getElementById('dash-alert');
  if(last){
    const c = classifyGlucose(last.value, last.condition);
    if(c.level === 'danger'){
      alertBox.classList.remove('hidden');
      alertBox.classList.remove('alert-warning');
      alertBox.innerHTML = `<strong>⚠️ Perhatian: gula darah ${c.label.toLowerCase()}</strong>Nilai terakhir ${last.value} mg/dL. Pertimbangkan segera hubungi keluarga atau tenaga medis.`;
    } else if(c.level === 'warn'){
      alertBox.classList.remove('hidden');
      alertBox.classList.add('alert-warning');
      alertBox.innerHTML = `<strong>Gula darah sedikit tinggi</strong>Nilai terakhir ${last.value} mg/dL. Jaga pola makan dan pantau kembali nanti.`;
    } else {
      alertBox.classList.add('hidden');
    }
  } else {
    alertBox.classList.add('hidden');
  }

  // Nurse note banner
  const noteBox = document.getElementById('dash-nurse-note');
  const unread = u.nurseNotes && u.nurseNotes.length ? u.nurseNotes[u.nurseNotes.length-1] : null;
  if(unread){
    noteBox.classList.remove('hidden');
    noteBox.innerHTML = `<span class="nn-label">📩 Catatan dari ${unread.from || 'Perawat'}</span>${unread.text}`;
  } else {
    noteBox.classList.add('hidden');
  }
}

/* ---------------------------------------------------------
   Rendering — Glucose history
   --------------------------------------------------------- */
function renderGlucoseHistory(){
  const wrap = document.getElementById('glucose-history');
  const entries = [...currentUser.glucose].sort((a,b)=>b.ts-a.ts);
  if(!entries.length){
    wrap.innerHTML = '<p class="empty-state">Belum ada data pemeriksaan.</p>';
    return;
  }
  wrap.innerHTML = entries.map(e => {
    const c = classifyGlucose(e.value, e.condition);
    const date = new Date(e.ts).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    return `
      <div class="list-item">
        <div class="li-top">
          <div>
            <div class="li-value">${e.value} mg/dL <span class="badge ${c.cls}">${c.label}</span></div>
            <div class="li-meta">${date} · ${e.condition}</div>
            ${e.note ? `<div class="li-note">"${escapeHtml(e.note)}"</div>` : ''}
          </div>
          <button class="li-icon-btn" data-del-glucose="${e.id}" title="Hapus">🗑</button>
        </div>
        <div class="li-actions">
          <button class="btn btn-outline" data-share-glucose="${e.id}">💬 Bagikan ke Keluarga</button>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------------------------------------------------
   Rendering — Meds
   --------------------------------------------------------- */
function renderMedList(){
  const wrap = document.getElementById('med-list');
  if(!currentUser.meds.length){
    wrap.innerHTML = '<p class="empty-state">Belum ada obat terdaftar.</p>';
    return;
  }
  const today = todayStr();
  wrap.innerHTML = currentUser.meds.map(m => `
    <div class="list-item">
      <div class="li-top">
        <div>
          <div class="li-value">${escapeHtml(m.name)}</div>
          <div class="li-meta">${escapeHtml(m.dose)} · pukul ${m.time}</div>
        </div>
        <button class="li-icon-btn" data-del-med="${m.id}" title="Hapus">🗑</button>
      </div>
      <label class="med-check">
        <input type="checkbox" data-taken-med="${m.id}" ${m.takenDate === today ? 'checked' : ''}>
        Sudah diminum hari ini
      </label>
    </div>`).join('');
}

/* ---------------------------------------------------------
   Rendering — Education (konten umum, bukan anjuran dosis)
   --------------------------------------------------------- */
const EDU_CONTENT = [
  { icon:'📘', title:'Apa itu Diabetes Melitus?', text:'Kondisi kadar gula darah lebih tinggi dari normal karena tubuh tidak dapat menghasilkan atau menggunakan insulin dengan baik. Perlu dipantau dan dikelola bersama tenaga medis secara rutin.' },
  { icon:'🚩', title:'Kenali Gejalanya', text:'Sering haus, sering buang air kecil, mudah lelah, pandangan kabur, dan luka yang lambat sembuh. Bila muncul gejala baru, konsultasikan ke dokter atau puskesmas terdekat.' },
  { icon:'🥗', title:'Pola Makan Seimbang', text:'Utamakan sayur, protein, dan porsi karbohidrat yang terkontrol. Batasi makanan dan minuman manis. Diskusikan pola makan yang sesuai dengan dokter atau ahli gizi.' },
  { icon:'🏃', title:'Aktif Bergerak Setiap Hari', text:'Aktivitas fisik ringan-sedang secara rutin membantu tubuh menggunakan gula darah lebih baik. Mulai dari jalan kaki 20–30 menit, sesuai anjuran dokter.' },
  { icon:'💊', title:'Patuh Minum Obat', text:'Minum obat sesuai jadwal yang diresepkan dokter. Jangan menghentikan atau mengubah dosis sendiri — selalu konsultasikan perubahan apa pun ke dokter.' },
  { icon:'⚠️', title:'Kenali Tanda Bahaya', text:'Gula darah sangat rendah (lemas, gemetar, keringat dingin) atau sangat tinggi (mual, napas cepat, kesadaran menurun) adalah kondisi darurat. Segera cari bantuan medis.' }
];
function renderEducation(){
  const grid = document.getElementById('edu-grid');
  grid.innerHTML = EDU_CONTENT.map(e => `
    <div class="edu-card">
      <div class="edu-icon">${e.icon}</div>
      <div>
        <div class="edu-title">${e.title}</div>
        <div class="edu-text">${e.text}</div>
      </div>
    </div>`).join('');
}

/* ---------------------------------------------------------
   Rendering — Progress + chart
   --------------------------------------------------------- */
function renderProgress(){
  const entries = [...currentUser.glucose].sort((a,b)=>a.ts-b.ts);
  document.getElementById('prog-count').textContent = entries.length;
  document.getElementById('prog-last').textContent = entries.length ? entries[entries.length-1].value + ' mg/dL' : '-';
  drawChart(entries);
}

function drawChart(entries){
  const canvas = document.getElementById('glucose-chart');
  const emptyMsg = document.getElementById('chart-empty');
  const ctx = canvas.getContext('2d');

  if(entries.length < 2){
    canvas.classList.add('hidden');
    emptyMsg.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  emptyMsg.classList.add('hidden');

  const cssWidth = canvas.parentElement.clientWidth - 32;
  const cssHeight = 200;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssWidth,cssHeight);

  const data = entries.slice(-14);
  const values = data.map(d=>d.value);
  const minV = Math.min(...values, 60);
  const maxV = Math.max(...values, 220);
  const padL = 34, padR = 10, padT = 14, padB = 22;
  const plotW = cssWidth - padL - padR;
  const plotH = cssHeight - padT - padB;

  const styles = getComputedStyle(document.body);
  const border = styles.getPropertyValue('--clr-border').trim() || '#ddd';
  const muted = styles.getPropertyValue('--clr-muted').trim() || '#666';
  const primary = styles.getPropertyValue('--clr-primary').trim() || '#146356';
  const danger = styles.getPropertyValue('--clr-danger').trim() || '#B8443D';
  const accent = styles.getPropertyValue('--clr-accent').trim() || '#C98A2E';
  const success = styles.getPropertyValue('--clr-success').trim() || '#2F8F5B';

  function xFor(i){ return padL + (data.length === 1 ? plotW/2 : (i/(data.length-1)) * plotW); }
  function yFor(v){ return padT + plotH - ((v - minV) / (maxV - minV || 1)) * plotH; }

  // grid lines
  ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.font = '10px "Work Sans", sans-serif'; ctx.fillStyle = muted;
  [minV, (minV+maxV)/2, maxV].forEach(v=>{
    const y = yFor(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssWidth - padR, y); ctx.stroke();
    ctx.fillText(Math.round(v), 2, y+3);
  });

  // line
  ctx.beginPath();
  data.forEach((d,i)=>{
    const x = xFor(i), y = yFor(d.value);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.strokeStyle = primary; ctx.lineWidth = 2.5; ctx.stroke();

  // points
  data.forEach((d,i)=>{
    const x = xFor(i), y = yFor(d.value);
    const c = classifyGlucose(d.value, d.condition);
    ctx.beginPath();
    ctx.arc(x,y,4,0,Math.PI*2);
    ctx.fillStyle = c.level==='danger' ? danger : c.level==='warn' ? accent : success;
    ctx.fill();
  });
}

/* ---------------------------------------------------------
   Rendering — Profile
   --------------------------------------------------------- */
function renderProfile(){
  const u = currentUser;
  document.getElementById('profile-name').value = u.name || '';
  document.getElementById('profile-age').value = u.age || '';
  document.getElementById('profile-gender').value = u.gender || 'Laki-laki';
  document.getElementById('profile-email').value = u.email || '';
  document.getElementById('profile-phone').value = u.phone || '';
  document.getElementById('family-name').value = u.familyName || '';
  document.getElementById('family-phone').value = u.familyPhone || '';
  document.getElementById('nurse-phone').value = u.nursePhone || '';
  document.getElementById('toggle-share').checked = !!u.shareWithFamily;
  document.getElementById('toggle-dark').checked = !!u.darkMode;
}

/* ---------------------------------------------------------
   Emergency modal
   --------------------------------------------------------- */
function refreshEmergencyLinks(mapsLink){
  const u = currentUser;
  const famCall = document.getElementById('emg-call-family');
  const famWa = document.getElementById('emg-wa-family');
  const nurseWa = document.getElementById('emg-wa-nurse');
  const msg = buildEmergencyMessage(u, mapsLink);

  if(u.familyPhone){
    famCall.href = 'tel:' + toWaNumber(u.familyPhone);
    famCall.classList.remove('hidden');
    famWa.href = waLink(u.familyPhone, msg);
    famWa.classList.remove('hidden');
  } else {
    famCall.classList.add('hidden');
    famWa.classList.add('hidden');
  }

  if(u.nursePhone){
    nurseWa.href = waLink(u.nursePhone, msg);
    nurseWa.classList.remove('hidden');
  } else {
    nurseWa.classList.add('hidden');
  }
}

function openEmergencyModal(){
  const u = currentUser;
  const last = lastGlucoseEntry(u);
  const statusBox = document.getElementById('emergency-status');
  if(last){
    const c = classifyGlucose(last.value, last.condition);
    statusBox.className = 'alert-box' + (c.level === 'warn' ? ' alert-warning' : '');
    statusBox.innerHTML = `<strong>Gula darah terakhir: ${last.value} mg/dL</strong>Status: ${c.label}`;
  } else {
    statusBox.className = 'alert-box';
    statusBox.innerHTML = '<strong>Belum ada data gula darah</strong>Tetap hubungi bantuan bila kondisi memburuk.';
  }

  // Render dulu tanpa lokasi supaya tombol langsung bisa dipakai (call/119 tidak perlu menunggu)
  refreshEmergencyLinks(null);

  if(!u.familyPhone && !u.nursePhone){
    showToast('Tips: isi nomor WA keluarga di Profil agar SOS lebih siap pakai.');
  }

  document.getElementById('emergency-modal').classList.remove('hidden');

  const locBox = document.getElementById('emergency-location');
  locBox.className = 'location-box';
  locBox.textContent = '📍 Mendeteksi lokasi...';

  requestLocationOnce().then(loc => {
    const link = mapsLinkFor(loc);
    locBox.className = 'location-box loc-ready';
    locBox.innerHTML = `📍 Lokasi terdeteksi (akurasi ~${Math.round(loc.accuracy)}m) — <a href="${link}" target="_blank" rel="noopener">buka di Google Maps</a>. Lokasi ini sudah otomatis disertakan pada pesan WhatsApp di bawah.`;
    refreshEmergencyLinks(link);
  }).catch(() => {
    locBox.className = 'location-box';
    locBox.textContent = '📍 Lokasi tidak dapat diakses. Pastikan izin lokasi diaktifkan di browser, atau sebutkan lokasi Anda lewat telepon.';
  });
}
function closeEmergencyModal(){
  document.getElementById('emergency-modal').classList.add('hidden');
}

/* ---------------------------------------------------------
   AUTH — Patient login/register
   --------------------------------------------------------- */
function loginPatient(email, password, users){
  let idx = findUserIndex(users, email);
  if(idx === -1){
    const u = newUser(email, password);
    users.push(u);
    saveUsers(users);
    return u;
  }
  const u = users[idx];
  if(u.password !== password) return null;
  return u;
}

function afterPatientAuth(user){
  currentUser = user;
  setSession({ role:'pasien', email:user.email });
  if(user.pin){
    showTopScreen('screen-pin');
  } else {
    enterApp();
  }
}

function enterApp(){
  applyDarkMode(currentUser.darkMode);
  showTopScreen('app-shell');
  navigateApp('dashboard');
  renderGlucoseHistory();
  renderMedList();
  renderEducation();
  renderProfile();
}

/* ---------------------------------------------------------
   AUTH — Nurse
   --------------------------------------------------------- */
function loginNurse(name, code){
  nurseSession = { name, code };
  setSession({ role:'perawat', name, code });
  document.getElementById('nurse-name-display').textContent = name;
  showTopScreen('screen-nurse');
  renderNursePatientList('');
  document.getElementById('nurse-list-view').classList.remove('hidden');
  document.getElementById('nurse-detail-view').classList.add('hidden');
}

function renderNursePatientList(query){
  const users = loadUsers();
  const q = (query || '').toLowerCase();
  const filtered = users.filter(u => (u.name || '').toLowerCase().includes(q));
  const wrap = document.getElementById('nurse-patient-list');
  if(!filtered.length){
    wrap.innerHTML = '<p class="empty-state">Tidak ada pasien ditemukan pada perangkat ini.</p>';
    return;
  }
  wrap.innerHTML = filtered.map(u => {
    const last = lastGlucoseEntry(u);
    const c = last ? classifyGlucose(last.value, last.condition) : null;
    return `
      <div class="list-item patient-row" data-open-patient="${u.email}">
        <div>
          <div class="patient-row-name">${escapeHtml(u.name || u.email)}</div>
          <div class="patient-row-meta">${u.age ? u.age+' th · ' : ''}${u.gender || ''}</div>
        </div>
        <span class="badge ${c ? c.cls : 'badge-neutral'}">${c ? c.label : 'Belum ada data'}</span>
      </div>`;
  }).join('');
}

let activePatientEmail = null;
function openPatientDetail(email){
  const users = loadUsers();
  const u = users.find(x => x.email === email);
  if(!u) return;
  activePatientEmail = email;

  document.getElementById('nurse-list-view').classList.add('hidden');
  document.getElementById('nurse-detail-view').classList.remove('hidden');

  document.getElementById('nd-name').textContent = u.name || u.email;
  document.getElementById('nd-meta').textContent = `${u.age ? u.age+' tahun · ' : ''}${u.gender || ''} · ${u.email}`;

  const last = lastGlucoseEntry(u);
  const flag = document.getElementById('nd-flag');
  if(last){
    const c = classifyGlucose(last.value, last.condition);
    flag.textContent = c.label;
    flag.className = 'badge ' + c.cls;
  } else {
    flag.textContent = 'Belum ada data';
    flag.className = 'badge badge-neutral';
  }

  const callHref = u.phone ? 'tel:' + toWaNumber(u.phone) : '#';
  const waHref = u.phone ? waLink(u.phone, `Halo ${u.name}, ini dari tenaga medis mengenai pemantauan gula darah Anda.`) : '#';
  document.getElementById('nd-call').href = callHref;
  document.getElementById('nd-wa').href = waHref;
  if(!u.phone) showToast('Pasien belum mengisi nomor HP di Profil.');

  const histWrap = document.getElementById('nd-glucose-history');
  const entries = [...u.glucose].sort((a,b)=>b.ts-a.ts).slice(0,10);
  histWrap.innerHTML = entries.length ? entries.map(e=>{
    const c = classifyGlucose(e.value, e.condition);
    const date = new Date(e.ts).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    return `<div class="list-item"><div class="li-top"><div>
      <div class="li-value">${e.value} mg/dL <span class="badge ${c.cls}">${c.label}</span></div>
      <div class="li-meta">${date} · ${e.condition}</div>
    </div></div></div>`;
  }).join('') : '<p class="empty-state">Belum ada data pemeriksaan.</p>';

  const medWrap = document.getElementById('nd-med-list');
  medWrap.innerHTML = u.meds.length ? u.meds.map(m=>`
    <div class="list-item"><div class="li-top"><div>
      <div class="li-value">${escapeHtml(m.name)}</div>
      <div class="li-meta">${escapeHtml(m.dose)} · pukul ${m.time}</div>
    </div></div></div>`).join('') : '<p class="empty-state">Belum ada obat terdaftar.</p>';
}

function sendNurseNote(text){
  const users = loadUsers();
  const idx = findUserIndex(users, activePatientEmail);
  if(idx === -1) return;
  users[idx].nurseNotes.push({ id: uid(), text, from: nurseSession ? nurseSession.name : 'Perawat', ts: Date.now() });
  saveUsers(users);
  showToast('Catatan terkirim ke pasien.');
}

/* ---------------------------------------------------------
   Logout
   --------------------------------------------------------- */
function logoutPatient(){
  currentUser = null;
  clearSession();
  document.getElementById('form-login').reset();
  showTopScreen('screen-login');
}
function logoutNurse(){
  nurseSession = null;
  activePatientEmail = null;
  clearSession();
  showTopScreen('screen-login');
}

/* ===========================================================
   EVENT WIRING
   =========================================================== */
document.addEventListener('DOMContentLoaded', () => {
  ensureDemoUser();

  /* ---- Role tabs on login screen ---- */
  document.querySelectorAll('.role-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('.role-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const isNurse = tab.dataset.role === 'perawat';
      document.getElementById('form-login').classList.toggle('hidden', isNurse);
      document.getElementById('form-login-nurse').classList.toggle('hidden', !isNurse);
      document.getElementById('nurse-hint').classList.toggle('hidden', !isNurse);
      document.querySelector('.login-hint:not(#nurse-hint)').classList.toggle('hidden', isNurse);
    });
  });

  /* ---- Patient login ---- */
  document.getElementById('form-login').addEventListener('submit', e=>{
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const users = loadUsers();
    const idx = findUserIndex(users, email);

    if(idx > -1 && users[idx].password !== password){
      errEl.textContent = 'Password salah untuk akun ini.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    const user = loginPatient(email, password, users);
    afterPatientAuth(user);
  });

  document.getElementById('btn-demo-login').addEventListener('click', ()=>{
    const users = loadUsers();
    const user = users.find(u=>u.email==='demo@sigapdm.id');
    afterPatientAuth(user);
  });

  /* ---- Nurse login ---- */
  document.getElementById('form-login-nurse').addEventListener('submit', e=>{
    e.preventDefault();
    const name = document.getElementById('nurse-name').value.trim();
    const code = document.getElementById('nurse-code').value.trim();
    const errEl = document.getElementById('nurse-login-error');
    if(code.length < 4){
      errEl.textContent = 'Kode akses minimal 4 karakter.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    loginNurse(name, code);
  });

  /* ---- PIN screen ---- */
  document.getElementById('btn-pin-submit').addEventListener('click', ()=>{
    const val = document.getElementById('pin-input').value;
    const errEl = document.getElementById('pin-error');
    if(val === currentUser.pin){
      errEl.classList.add('hidden');
      document.getElementById('pin-input').value = '';
      enterApp();
    } else {
      errEl.textContent = 'PIN salah, coba lagi.';
      errEl.classList.remove('hidden');
    }
  });
  document.getElementById('btn-pin-skip').addEventListener('click', ()=>{
    document.getElementById('pin-input').value = '';
    logoutPatient();
  });

  /* ---- Bottom nav + quick menu ---- */
  document.querySelectorAll('.nav-btn, .quick-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> navigateApp(btn.dataset.goto));
  });

  /* ---- Theme toggles ---- */
  document.getElementById('btn-theme-toggle').addEventListener('click', ()=>{
    const on = !document.body.classList.contains('dark-mode');
    applyDarkMode(on);
    currentUser.darkMode = on;
    persistCurrentUser();
  });
  document.getElementById('toggle-dark').addEventListener('change', e=>{
    applyDarkMode(e.target.checked);
    currentUser.darkMode = e.target.checked;
    persistCurrentUser();
  });

  /* ---- Glucose form ---- */
  document.getElementById('form-glucose').addEventListener('submit', e=>{
    e.preventDefault();
    const value = parseInt(document.getElementById('glucose-value').value, 10);
    const condition = document.getElementById('glucose-condition').value;
    const note = document.getElementById('glucose-note').value.trim();
    const errEl = document.getElementById('glucose-error');
    if(!value || value <= 0){
      errEl.textContent = 'Masukkan nilai gula darah yang valid.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    currentUser.glucose.push({ id: uid(), value, condition, note, ts: Date.now() });
    persistCurrentUser();
    e.target.reset();
    renderGlucoseHistory();
    renderDashboard();

    const c = classifyGlucose(value, condition);
    if(c.level === 'danger'){
      showToast('⚠️ Nilai kritis terdeteksi — pertimbangkan tombol SOS.');
    } else {
      showToast('Data gula darah tersimpan.');
    }
  });

  document.getElementById('glucose-history').addEventListener('click', e=>{
    const delId = e.target.dataset.delGlucose;
    const shareId = e.target.dataset.shareGlucose;
    if(delId){
      if(confirm('Hapus data pemeriksaan ini?')){
        currentUser.glucose = currentUser.glucose.filter(g=>g.id!==delId);
        persistCurrentUser();
        renderGlucoseHistory();
        renderDashboard();
      }
    }
    if(shareId){
      const entry = currentUser.glucose.find(g=>g.id===shareId);
      if(!entry) return;
      if(!currentUser.familyPhone){
        showToast('Isi nomor WA keluarga di Profil terlebih dahulu.');
        return;
      }
      const c = classifyGlucose(entry.value, entry.condition);
      const msg = `Laporan gula darah ${currentUser.name}: ${entry.value} mg/dL (${entry.condition}), status ${c.label}, dicatat ${new Date(entry.ts).toLocaleString('id-ID')}.`;
      window.open(waLink(currentUser.familyPhone, msg), '_blank');
    }
  });

  /* ---- Med form ---- */
  document.getElementById('form-med').addEventListener('submit', e=>{
    e.preventDefault();
    const name = document.getElementById('med-name').value.trim();
    const dose = document.getElementById('med-dose').value.trim();
    const time = document.getElementById('med-time').value;
    const errEl = document.getElementById('med-error');
    if(!name || !dose || !time){
      errEl.textContent = 'Lengkapi semua data obat.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    currentUser.meds.push({ id: uid(), name, dose, time, takenDate:null });
    persistCurrentUser();
    e.target.reset();
    renderMedList();
    renderDashboard();
    showToast('Obat ditambahkan.');
  });

  document.getElementById('med-list').addEventListener('click', e=>{
    const delId = e.target.dataset.delMed;
    if(delId && confirm('Hapus obat ini?')){
      currentUser.meds = currentUser.meds.filter(m=>m.id!==delId);
      persistCurrentUser();
      renderMedList();
      renderDashboard();
    }
  });
  document.getElementById('med-list').addEventListener('change', e=>{
    const takenId = e.target.dataset.takenMed;
    if(takenId){
      const med = currentUser.meds.find(m=>m.id===takenId);
      med.takenDate = e.target.checked ? todayStr() : null;
      persistCurrentUser();
      renderDashboard();
    }
  });

  /* ---- Profile form ---- */
  document.getElementById('form-profile').addEventListener('submit', e=>{
    e.preventDefault();
    currentUser.name = document.getElementById('profile-name').value.trim() || currentUser.name;
    currentUser.age = document.getElementById('profile-age').value;
    currentUser.gender = document.getElementById('profile-gender').value;
    currentUser.phone = document.getElementById('profile-phone').value.trim();
    persistCurrentUser();
    renderDashboard();
    showToast('Profil tersimpan.');
  });

  /* ---- Emergency contact form ---- */
  document.getElementById('form-emergency-contact').addEventListener('submit', e=>{
    e.preventDefault();
    currentUser.familyName = document.getElementById('family-name').value.trim();
    currentUser.familyPhone = document.getElementById('family-phone').value.trim();
    currentUser.nursePhone = document.getElementById('nurse-phone').value.trim();
    persistCurrentUser();
    showToast('Kontak darurat tersimpan.');
  });

  document.getElementById('toggle-share').addEventListener('change', e=>{
    currentUser.shareWithFamily = e.target.checked;
    persistCurrentUser();
  });

  /* ---- PIN set in profile ---- */
  document.getElementById('btn-set-pin').addEventListener('click', ()=>{
    document.getElementById('pin-set-area').classList.toggle('hidden');
  });
  document.getElementById('btn-save-pin').addEventListener('click', ()=>{
    const val = document.getElementById('new-pin').value;
    if(!/^\d{4}$/.test(val)){
      showToast('PIN harus 4 digit angka.');
      return;
    }
    currentUser.pin = val;
    persistCurrentUser();
    document.getElementById('new-pin').value = '';
    document.getElementById('pin-set-area').classList.add('hidden');
    showToast('PIN berhasil diatur.');
  });

  /* ---- Logout ---- */
  document.getElementById('btn-logout').addEventListener('click', ()=>{
    if(confirm('Yakin ingin logout?')) logoutPatient();
  });
  document.getElementById('btn-nurse-logout').addEventListener('click', ()=>{
    if(confirm('Keluar dari dasbor perawat?')) logoutNurse();
  });

  /* ---- Nurse dashboard interactions ---- */
  document.getElementById('nurse-search').addEventListener('input', e=>{
    renderNursePatientList(e.target.value);
  });
  document.getElementById('nurse-patient-list').addEventListener('click', e=>{
    const email = e.target.closest('[data-open-patient]')?.dataset.openPatient;
    if(email) openPatientDetail(email);
  });
  document.getElementById('btn-nurse-back').addEventListener('click', ()=>{
    document.getElementById('nurse-detail-view').classList.add('hidden');
    document.getElementById('nurse-list-view').classList.remove('hidden');
    renderNursePatientList(document.getElementById('nurse-search').value);
  });
  document.getElementById('btn-nd-send-note').addEventListener('click', ()=>{
    const text = document.getElementById('nd-note-input').value.trim();
    if(!text){ showToast('Tulis catatan terlebih dahulu.'); return; }
    sendNurseNote(text);
    document.getElementById('nd-note-input').value = '';
  });

  /* ---- Emergency SOS ---- */
  document.getElementById('btn-sos').addEventListener('click', openEmergencyModal);
  document.getElementById('btn-open-emergency-from-dash').addEventListener('click', openEmergencyModal);
  document.getElementById('btn-close-emergency').addEventListener('click', closeEmergencyModal);
  document.getElementById('emergency-modal').addEventListener('click', e=>{
    if(e.target.id === 'emergency-modal') closeEmergencyModal();
  });

  /* ---- Share current location to family (quick action) ---- */
  document.getElementById('btn-share-location').addEventListener('click', ()=>{
    if(!currentUser.familyPhone){
      showToast('Isi nomor WA keluarga di Profil terlebih dahulu.');
      navigateApp('profil');
      return;
    }
    showToast('Mendeteksi lokasi...');
    requestLocationOnce().then(loc => {
      const link = mapsLinkFor(loc);
      const msg = `📍 Lokasi ${currentUser.name} saat ini: ${link}\nDikirim dari aplikasi SIGAP-DM pada ${new Date().toLocaleString('id-ID')}.`;
      window.open(waLink(currentUser.familyPhone, msg), '_blank');
    }).catch(()=>{
      showToast('Lokasi tidak dapat diakses. Aktifkan izin lokasi di browser.');
    });
  });

  /* ---- Family report from dashboard ---- */
  document.getElementById('btn-send-family-report').addEventListener('click', ()=>{
    if(!currentUser.familyPhone){
      showToast('Isi nomor WA keluarga di Profil terlebih dahulu.');
      navigateApp('profil');
      return;
    }
    const msg = buildFamilyReportMessage(currentUser);
    window.open(waLink(currentUser.familyPhone, msg), '_blank');
  });

  /* ---- Resume session on reload ---- */
  const session = getSession();
  if(session && session.role === 'pasien'){
    const users = loadUsers();
    const u = users.find(x=>x.email===session.email);
    if(u){ currentUser = u; enterApp(); return; }
  }
  if(session && session.role === 'perawat'){
    nurseSession = { name: session.name, code: session.code };
    document.getElementById('nurse-name-display').textContent = session.name;
    showTopScreen('screen-nurse');
    renderNursePatientList('');
    return;
  }
  showTopScreen('screen-login');
});

/* ---------------------------------------------------------
   PWA — daftarkan service worker (syarat agar bisa di-"Install"
   sebagai app di Android/Chrome)
   --------------------------------------------------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{
      /* diam-diam gagal, mis. saat dibuka langsung dari file:// tanpa server */
    });
  });
}

window.addEventListener('resize', ()=>{
  if(currentUser && document.getElementById('screen-progress').classList.contains('active-screen')){
    renderProgress();
  }
});
