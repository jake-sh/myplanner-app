// ── FIREBASE ───────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDmyo0wXdWXXclODKQY9vFMoBXca3ObuvM",
  authDomain: "chat-f2661.firebaseapp.com",
  projectId: "chat-f2661",
  storageBucket: "chat-f2661.firebasestorage.app",
  messagingSenderId: "722874427978",
  appId: "1:722874427978:web:b14a33019815a66240d4b3"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

auth.signInAnonymously().catch(e => console.log('Auth error:', e));
let currentUser = null;
auth.onAuthStateChanged(user => { currentUser = user; });

// ── STATE ──────────────────────────────────────────
const DEFAULT_PATTERN = [0,1,2,5,4,7,8];
let savedPattern = JSON.parse(localStorage.getItem('secPattern') || JSON.stringify(DEFAULT_PATTERN));
let currentPattern = [], isDragging = false;
let setupPattern = [], isSetupDragging = false;
let autoDeleteMinutes = parseInt(localStorage.getItem('autoDeleteMin') || '5');
let myCode = localStorage.getItem('myCode') || '';
let friends = JSON.parse(localStorage.getItem('friends') || '[]');
let activeFriendCode = null, chatRoomId = null;
let messageListener = null, friendsListener = null, roomListener = null, calListener = null;
let deleteTimers = {}, countdownTimers = {}, qrScanner = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let editingMemoIndex = null;

// ── INIT ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  updateFakeDate();
  const n = localStorage.getItem('appName');
  if (n) { document.getElementById('appTitle').textContent = n; document.title = n; }
  const t = localStorage.getItem('themeColor');
  if (t) document.documentElement.style.setProperty('--primary', t);
  showScreen('fakeApp');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

function updateFakeDate() {
  const d = new Date(), days = ['일','월','화','수','목','금','토'];
  document.getElementById('fakeDate').textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

// ── SCREEN ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── PATTERN ────────────────────────────────────────
function dotStart(e, dot) {
  e.preventDefault();
  isDragging = true;
  currentPattern = [dot];
  highlightDot(dot, true);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onDragEnd, { once: true });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onDragEnd, { once: true });
}

function onTouchMove(e) {
  e.preventDefault();
  const t = e.touches[0];
  checkDot(t.clientX, t.clientY);
}

function onMouseMove(e) {
  if (!isDragging) return;
  checkDot(e.clientX, e.clientY);
}

function onDragEnd() {
  if (!isDragging) return;
  isDragging = false;
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onDragEnd);

  const tapped = currentPattern[0];
  const len = currentPattern.length;
  clearDots();

  if (len < 2) {
    currentPattern = [];
    openFeature(tapped);
  } else if (arraysEqual(currentPattern, savedPattern)) {
    currentPattern = [];
    enterChatApp();
  } else {
    currentPattern = [];
  }
}

function checkDot(x, y) {
  document.querySelectorAll('#menuGrid .menu-item').forEach(item => {
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (Math.hypot(x - cx, y - cy) <= 24) {
      const d = parseInt(item.dataset.dot);
      if (!currentPattern.includes(d)) {
        currentPattern.push(d);
        highlightDot(d, true);
      }
    }
  });
}

function highlightDot(dot, on) {
  const el = document.querySelector(`#menuGrid [data-dot="${dot}"]`);
  if (el) el.classList.toggle('active', on);
}

function clearDots() {
  document.querySelectorAll('#menuGrid .menu-item').forEach(el => el.classList.remove('active'));
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Setup pattern dots
function setupDotStart(e, dot) {
  e.preventDefault();
  isSetupDragging = true;
  setupPattern = [dot];
  highlightSetupDot(dot, true);
  document.getElementById('setupStatus').textContent = '';
  document.getElementById('savePatternBtn').style.display = 'none';
  document.addEventListener('touchmove', onSetupTouchMove, { passive: false });
  document.addEventListener('touchend', onSetupDragEnd, { once: true });
  document.addEventListener('mousemove', onSetupMouseMove);
  document.addEventListener('mouseup', onSetupDragEnd, { once: true });
}

function onSetupTouchMove(e) { e.preventDefault(); checkSetupDot(e.touches[0].clientX, e.touches[0].clientY); }
function onSetupMouseMove(e) { if (isSetupDragging) checkSetupDot(e.clientX, e.clientY); }

function onSetupDragEnd() {
  if (!isSetupDragging) return;
  isSetupDragging = false;
  document.removeEventListener('touchmove', onSetupTouchMove);
  document.removeEventListener('mousemove', onSetupMouseMove);
  document.removeEventListener('mouseup', onSetupDragEnd);
  if (setupPattern.length < 4) {
    document.getElementById('setupStatus').textContent = '최소 4개 이상 연결하세요';
    setTimeout(() => { clearSetupDots(); setupPattern = []; document.getElementById('setupStatus').textContent = ''; }, 1000);
  } else {
    document.getElementById('setupStatus').textContent = `패턴 입력됨 (${setupPattern.length}개)`;
    document.getElementById('savePatternBtn').style.display = 'block';
  }
}

function checkSetupDot(x, y) {
  document.querySelectorAll('#setupGrid .menu-item').forEach(item => {
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (Math.hypot(x - cx, y - cy) <= 24) {
      const d = parseInt(item.dataset.dot);
      if (!setupPattern.includes(d)) { setupPattern.push(d); highlightSetupDot(d, true); }
    }
  });
}

function highlightSetupDot(dot, on) {
  const el = document.querySelector(`#setupGrid [data-dot="${dot}"]`);
  if (el) el.classList.toggle('active', on);
}

function clearSetupDots() {
  document.querySelectorAll('#setupGrid .menu-item').forEach(el => el.classList.remove('active'));
}

function savePattern() {
  if (setupPattern.length < 4) return;
  savedPattern = [...setupPattern];
  localStorage.setItem('secPattern', JSON.stringify(savedPattern));
  alert('패턴이 저장되었습니다!');
  showScreen('chatApp');
}

function openPatternSetup() {
  setupPattern = []; isSetupDragging = false; clearSetupDots();
  document.getElementById('setupStatus').textContent = '';
  document.getElementById('savePatternBtn').style.display = 'none';
  showScreen('patternSetup');
}

function cancelPatternSetup() {
  showScreen('chatApp');
  document.getElementById('secretSettingsModal').style.display = 'flex';
}

// ── FEATURE ROUTER ─────────────────────────────────
function openFeature(i) {
  if (i === 0) openTodo();
  else if (i === 3) openMemo();
  else if (i === 8) openCalendar();
  else openFakeFeature(i);
}

const fakeData = [
  null,
  ['10:00 팀 미팅','13:00 점심 약속','15:30 보고서 제출','18:00 퇴근'],
  ['⏰ 오전 7:30 기상','⏰ 오후 12:00 점심','⏰ 오후 6:00 퇴근'],
  null,
  ['🎯 운동 20회 (12/20)','🎯 독서 2권 (1/2)','🎯 저축 목표 달성'],
  ['✅ 완료 할일: 18개','📅 일정 소화율: 85%','🔥 연속 달성: 7일'],
  ['📁 웹사이트 리뉴얼','📁 마케팅 캠페인','📁 데이터 분석'],
  ['🏷️ 업무 (24)','🏷️ 개인 (12)','🏷️ 중요 (8)'],
  null
];
const fakeTitles = ['할 일','일정표','알림','메모','목표','통계','프로젝트','태그','달력'];

function openFakeFeature(i) {
  document.getElementById('featureTitle').textContent = fakeTitles[i];
  document.getElementById('featureContent').innerHTML =
    `<div class="feature-placeholder"><h3>${fakeTitles[i]}</h3>` +
    (fakeData[i]||[]).map(t=>`<div class="fake-item"><div class="fake-check"></div>${t}</div>`).join('') + '</div>';
  showScreen('fakeFeature');
}

// ── SETTINGS ───────────────────────────────────────
function openSettings() {
  document.getElementById('appNameInput').value = localStorage.getItem('appName') || '';
  showScreen('settingsScreen');
}
function saveAppName() {
  const n = document.getElementById('appNameInput').value.trim() || 'MyPlanner';
  localStorage.setItem('appName', n);
  document.getElementById('appTitle').textContent = n;
  document.title = n;
  alert('저장되었습니다');
}
function setTheme(c) { document.documentElement.style.setProperty('--primary', c); localStorage.setItem('themeColor', c); }

// ── 할 일 ───────────────────────────────────────────
function openTodo() { renderTodoList(); showScreen('todoScreen'); }
function renderTodoList() {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]');
  document.getElementById('todoCount').textContent = `${todos.filter(t=>t.done).length}/${todos.length}`;
  const el = document.getElementById('todoList');
  if (!todos.length) { el.innerHTML = `<div class="empty-state">📋<br/>할 일이 없습니다</div>`; return; }
  el.innerHTML = todos.map((t,i) => `
    <div class="todo-item ${t.done?'todo-done':''}">
      <div class="todo-check ${t.done?'checked':''}" onclick="toggleTodo(${i})">${t.done?'✓':''}</div>
      <span class="todo-text">${esc(t.text)}</span>
      <button class="todo-del" onclick="deleteTodo(${i})">×</button>
    </div>`).join('');
}
function addTodo() {
  const el = document.getElementById('todoInput'); const text = el.value.trim(); if (!text) return;
  const todos = JSON.parse(localStorage.getItem('todos') || '[]');
  todos.unshift({ text, done: false });
  localStorage.setItem('todos', JSON.stringify(todos)); el.value = ''; renderTodoList();
}
function toggleTodo(i) {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]'); todos[i].done = !todos[i].done;
  localStorage.setItem('todos', JSON.stringify(todos)); renderTodoList();
}
function deleteTodo(i) {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]'); todos.splice(i,1);
  localStorage.setItem('todos', JSON.stringify(todos)); renderTodoList();
}

// ── 메모 ───────────────────────────────────────────
function openMemo() { renderMemoList(); showScreen('memoScreen'); }
function renderMemoList() {
  const memos = JSON.parse(localStorage.getItem('memos') || '[]');
  const el = document.getElementById('memoList');
  if (!memos.length) { el.innerHTML = `<div class="empty-state">📝<br/>메모가 없습니다</div>`; return; }
  el.innerHTML = memos.map((m,i) => `
    <div class="memo-card" onclick="openEditMemo(${i})">
      <div class="memo-card-title">${esc(m.title||'제목 없음')}</div>
      <div class="memo-card-preview">${esc((m.content||'').substring(0,80))}</div>
      <div class="memo-card-footer">
        <span class="memo-card-date">${m.date||''}</span>
        <button class="memo-del" onclick="event.stopPropagation();deleteMemo(${i})">🗑</button>
      </div>
    </div>`).join('');
}
function openNewMemo() {
  editingMemoIndex = null;
  document.getElementById('memoEditorTitle').textContent = '새 메모';
  document.getElementById('memoTitleInput').value = '';
  document.getElementById('memoContentInput').value = '';
  showScreen('memoEditorScreen');
}
function openEditMemo(i) {
  editingMemoIndex = i;
  const memos = JSON.parse(localStorage.getItem('memos') || '[]');
  document.getElementById('memoEditorTitle').textContent = '메모 편집';
  document.getElementById('memoTitleInput').value = memos[i].title || '';
  document.getElementById('memoContentInput').value = memos[i].content || '';
  showScreen('memoEditorScreen');
}
function closeMemoEditor() { renderMemoList(); showScreen('memoScreen'); }
function saveMemo() {
  const title = document.getElementById('memoTitleInput').value.trim();
  const content = document.getElementById('memoContentInput').value.trim();
  if (!title && !content) { alert('내용을 입력하세요'); return; }
  const memos = JSON.parse(localStorage.getItem('memos') || '[]');
  const date = new Date().toLocaleDateString('ko-KR');
  if (editingMemoIndex !== null) memos[editingMemoIndex] = { title, content, date };
  else memos.unshift({ title, content, date });
  localStorage.setItem('memos', JSON.stringify(memos)); closeMemoEditor();
}
function deleteMemo(i) {
  if (!confirm('메모를 삭제할까요?')) return;
  const memos = JSON.parse(localStorage.getItem('memos') || '[]'); memos.splice(i,1);
  localStorage.setItem('memos', JSON.stringify(memos)); renderMemoList();
}

// ── 달력 ───────────────────────────────────────────
function getSharedCalId() {
  const f = JSON.parse(localStorage.getItem('friends') || '[]');
  if (!myCode || !f.length) return null;
  return [myCode, f[0]].sort().join('_cal_');
}

function openCalendar() {
  showScreen('calendarScreen');
  if (calListener) { calListener(); calListener = null; }
  const sid = getSharedCalId();
  if (sid) {
    let firstCalLoad = true;
    calListener = db.collection('calendars').doc(sid).onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data();
        localStorage.setItem('habits', JSON.stringify(data.habits || {}));
        // 상대방이 업데이트한 경우만 알림
        if (!firstCalLoad && data.updatedBy && data.updatedBy !== myCode) {
          sendNotification('📅 일정 알림', '일정이 추가되었어요');
        }
        firstCalLoad = false;
      }
      renderCalendar();
    });
  } else {
    renderCalendar();
  }
}

function renderCalendar() {
  const now = new Date();
  const habits = JSON.parse(localStorage.getItem('habits') || '{}');
  const key = `${calYear}-${calMonth}`;
  let dayMap = habits[key] || {};
  // 이전 버전 배열 호환
  if (Array.isArray(dayMap)) { const tmp = {}; dayMap.forEach(d => { tmp[d] = 'done'; }); dayMap = tmp; }
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('calTitle').textContent = `${calYear}년 ${months[calMonth]}`;
  const syncEl = document.getElementById('calSyncStatus');
  if (syncEl) syncEl.textContent = '';
  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const today = d===now.getDate() && calMonth===now.getMonth() && calYear===now.getFullYear();
    const color = dayMap[d];
    const dow = (firstDay+d-1)%7;
    const cls = ['cal-day', today?'cal-today':(color?`cal-color-${color}`:''), dow===0?'sun':dow===6?'sat':''].filter(Boolean).join(' ');
    html += `<div class="${cls}" ontouchend="toggleHabit(${d});event.preventDefault();" onclick="toggleHabit(${d})">${d}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  const doneCount = Object.values(dayMap).filter(v => v && v !== 'clear').length;
  const sorted = Object.keys(dayMap).map(Number).sort((a,b)=>b-a);
  let streak = 0;
  if (sorted.length) { streak = 1; for (let i=0;i<sorted.length-1;i++){if(sorted[i]-sorted[i+1]===1)streak++;else break;} }
  document.getElementById('calDoneCount').textContent = doneCount;
  document.getElementById('calRate').textContent = Math.round(doneCount/daysInMonth*100)+'%';
  document.getElementById('calStreak').textContent = streak;
}

let selectedPalette = null;

function selectPalette(color) {
  if (selectedPalette === color) {
    selectedPalette = null;
    document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('pal-active'));
  } else {
    selectedPalette = color;
    document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('pal-active'));
    document.querySelector(`.pal-btn[data-color="${color}"]`)?.classList.add('pal-active');
  }
}

async function toggleHabit(day) {
  if (!selectedPalette) return; // 파레트 미선택 시 아무 동작 안 함
  const habits = JSON.parse(localStorage.getItem('habits') || '{}');
  const key = `${calYear}-${calMonth}`;
  if (!habits[key]) habits[key] = {};
  if (Array.isArray(habits[key])) {
    const arr = habits[key]; habits[key] = {};
    arr.forEach(d => { habits[key][d] = 'done'; });
  }
  if (selectedPalette === 'clear') {
    delete habits[key][day];
  } else {
    habits[key][day] = selectedPalette;
  }
  localStorage.setItem('habits', JSON.stringify(habits));
  renderCalendar();
  const sid = getSharedCalId();
  if (sid) await db.collection('calendars').doc(sid).set({ habits, updatedBy: myCode, ts: firebase.firestore.Timestamp.now() }).catch(() => {});
}

function refreshCalendar() {
  if (calListener) { calListener(); calListener = null; }
  const sid = getSharedCalId();
  if (sid) {
    calListener = db.collection('calendars').doc(sid).onSnapshot(snap => {
      if (snap.exists) localStorage.setItem('habits', JSON.stringify(snap.data().habits || {}));
      renderCalendar();
    });
  } else {
    renderCalendar();
  }
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── SECRET CHAT ─────────────────────────────────────
function enterChatApp() {
  applyChatTheme();
  showScreen('chatApp');
  initFCM();
  if (!myCode) {
    document.getElementById('chatSetup').style.display = 'flex';
    document.getElementById('friendListView').style.display = 'none';
    document.getElementById('activeChatView').style.display = 'none';
  } else {
    showFriendList();
  }
}

function exitChat() {
  if (messageListener) { messageListener(); messageListener = null; }
  if (friendsListener) { friendsListener(); friendsListener = null; }
  if (roomListener) { roomListener(); roomListener = null; }
  if (calListener) { calListener(); calListener = null; }
  stopQrScanner();
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};
  showScreen('fakeApp');
}

function saveMyCode() {
  const code = document.getElementById('myCodeInput').value.trim().toUpperCase();
  if (!code || code.length < 2) { alert('2자 이상 입력하세요'); return; }
  myCode = code; localStorage.setItem('myCode', myCode);
  db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() }, { merge: true });
  showFriendList();
}

function showFriendList() {
  document.getElementById('chatSetup').style.display = 'none';
  document.getElementById('friendListView').style.display = 'flex';
  document.getElementById('activeChatView').style.display = 'none';
  renderFriendList();
  listenFriendChanges();
}

function renderFriendList() {
  friends = JSON.parse(localStorage.getItem('friends') || '[]');
  const el = document.getElementById('friendList');
  if (!friends.length) {
    el.innerHTML = `<div class="no-friend"><div class="big-icon">👤</div><div>친구를 추가하면 채팅이 시작됩니다</div></div>`;
    return;
  }
  el.innerHTML = friends.map(f => `
    <div class="friend-item">
      <div class="friend-avatar" onclick="openChat('${f}')">${f[0]}</div>
      <div class="friend-name" onclick="openChat('${f}')">${f}</div>
      <button class="friend-del-btn" onclick="deleteChat('${f}')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`).join('');
}

function listenFriendChanges() {
  if (!myCode) return;
  if (friendsListener) friendsListener();
  friendsListener = db.collection('users').doc(myCode).onSnapshot(snap => {
    if (!snap.exists) return;
    friends = snap.data().friends || [];
    localStorage.setItem('friends', JSON.stringify(friends));
    renderFriendList();
  });
}

async function deleteChat(friendCode) {
  if (!confirm(`${friendCode}와의 채팅 내용을 삭제할까요?\n친구는 유지됩니다.`)) return;
  const roomId = [myCode, friendCode].sort().join('_');
  const snap = await db.collection('rooms').doc(roomId).collection('messages').get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  alert('채팅 내용이 삭제되었습니다');
}

// ── ADD FRIEND ──────────────────────────────────────
function openAddFriend() { document.getElementById('addFriendModal').style.display = 'flex'; switchAddTab('code'); }
function closeAddFriend() { stopQrScanner(); document.getElementById('addFriendModal').style.display = 'none'; }

function switchAddTab(tab) {
  ['code','qr','myqr'].forEach(t => {
    document.getElementById('addTab' + t[0].toUpperCase() + t.slice(1)).style.display = 'none';
    document.getElementById('tabBtn' + t[0].toUpperCase() + t.slice(1)).classList.remove('active');
  });
  const el = document.getElementById('addTab' + tab[0].toUpperCase() + tab.slice(1));
  el.style.display = tab === 'myqr' ? 'flex' : 'block';
  document.getElementById('tabBtn' + tab[0].toUpperCase() + tab.slice(1)).classList.add('active');
  if (tab === 'myqr') renderMyQr();
  else if (tab === 'qr') startQrScanner();
  else stopQrScanner();
}

async function addFriendByCode() {
  const code = document.getElementById('friendCodeInput').value.trim().toUpperCase();
  if (!code) { alert('코드를 입력하세요'); return; }
  if (code === myCode) { alert('자신의 코드는 추가할 수 없습니다'); return; }
  if (friends.includes(code)) { alert('이미 추가된 친구입니다'); return; }

  // 존재하는 사용자인지 확인
  const snap = await db.collection('users').doc(code).get();
  if (!snap.exists) { alert(`"${code}" 는 등록되지 않은 사용자예요`); return; }

  friends.push(code); localStorage.setItem('friends', JSON.stringify(friends));
  await db.collection('users').doc(myCode).set({ friends: firebase.firestore.FieldValue.arrayUnion(code) }, { merge: true });
  await db.collection('users').doc(code).set({ friends: firebase.firestore.FieldValue.arrayUnion(myCode) }, { merge: true });
  renderFriendList(); closeAddFriend(); alert(`${code} 추가되었습니다`);
}

function renderMyQr() {
  const wrap = document.getElementById('myQrCode'); wrap.innerHTML = '';
  document.getElementById('myCodeDisplay2').textContent = myCode;
  if (typeof QRCode !== 'undefined') new QRCode(wrap, { text: 'SECURECHAT:'+myCode, width: 180, height: 180 });
}

function startQrScanner() {
  const wrap = document.getElementById('qrScannerWrap'); wrap.innerHTML = '';
  if (typeof Html5Qrcode === 'undefined') { wrap.innerHTML = '<p style="color:#64748b;font-size:13px;text-align:center;">코드 직접 입력을 사용하세요.</p>'; return; }
  qrScanner = new Html5Qrcode('qrScannerWrap');
  qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 200 }, decoded => {
    if (decoded.startsWith('SECURECHAT:')) {
      const code = decoded.replace('SECURECHAT:', '');
      stopQrScanner();
      friends.push(code); localStorage.setItem('friends', JSON.stringify(friends));
      db.collection('users').doc(myCode).set({ friends: firebase.firestore.FieldValue.arrayUnion(code) }, { merge: true });
      db.collection('users').doc(code).set({ friends: firebase.firestore.FieldValue.arrayUnion(myCode) }, { merge: true });
      renderFriendList(); closeAddFriend(); alert(`${code} 추가되었습니다`);
    }
  }, () => {}).catch(() => { wrap.innerHTML = '<p style="color:#64748b;font-size:13px;text-align:center;">카메라 권한이 필요합니다</p>'; });
}

function stopQrScanner() { if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; } }

async function regenerateCode() {
  if (!confirm('코드를 재생성하면 모든 친구가 삭제됩니다. 계속할까요?')) return;
  for (const f of friends) { await db.collection('users').doc(f).update({ friends: firebase.firestore.FieldValue.arrayRemove(myCode) }).catch(() => {}); }
  await db.collection('users').doc(myCode).delete().catch(() => {});
  myCode = 'U' + Math.random().toString(36).substr(2,7).toUpperCase();
  friends = []; localStorage.setItem('myCode', myCode); localStorage.setItem('friends', '[]');
  await db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() });
  renderMyQr(); renderFriendList(); alert('코드 재생성: ' + myCode);
}

// ── CHANGE CODE ─────────────────────────────────────
function openChangeCode() { document.getElementById('changeCodeModal').style.display = 'flex'; document.getElementById('newCodeInput').value = ''; }
function closeChangeCode() { document.getElementById('changeCodeModal').style.display = 'none'; }

async function confirmChangeCode() {
  const newCode = document.getElementById('newCodeInput').value.trim().toUpperCase();
  if (!newCode || newCode.length < 2) { alert('2자 이상 입력하세요'); return; }
  if (newCode === myCode) { alert('현재 코드와 같습니다'); return; }
  if (!confirm(`코드를 "${newCode}"로 변경하면 모든 친구가 양측에서 삭제됩니다. 계속할까요?`)) return;
  for (const f of friends) { await db.collection('users').doc(f).update({ friends: firebase.firestore.FieldValue.arrayRemove(myCode) }).catch(() => {}); }
  await db.collection('users').doc(myCode).delete().catch(() => {});
  myCode = newCode; friends = [];
  localStorage.setItem('myCode', myCode); localStorage.setItem('friends', '[]');
  await db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() });
  closeChangeCode(); closeSecretSettings();
  renderFriendList(); alert('코드가 변경되었습니다: ' + myCode);
}

// ── CHAT ────────────────────────────────────────────
function openChat(friendCode) {
  activeFriendCode = friendCode;
  chatRoomId = [myCode, friendCode].sort().join('_');
  document.getElementById('friendListView').style.display = 'none';
  document.getElementById('activeChatView').style.display = 'flex';
  document.getElementById('chatFriendName').textContent = friendCode;
  updateAutoDeleteLabel();
  unreadCount = 0; setBadge(0);
  if (messageListener) { messageListener(); messageListener = null; }
  if (roomListener) { roomListener(); roomListener = null; }
  listenMessages();
  listenRoomSettings();
  // 읽지 않은 메시지 삭제 타이머 시작
  markMessagesRead();
}

function backToFriendList() {
  if (messageListener) { messageListener(); messageListener = null; }
  if (roomListener) { roomListener(); roomListener = null; }
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};
  activeFriendCode = null; chatRoomId = null;
  showFriendList();
}

function listenRoomSettings() {
  if (!chatRoomId) return;
  roomListener = db.collection('rooms').doc(chatRoomId).onSnapshot(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    const req = data.deleteRequest;
    if (!req) return;
    if (req.from !== myCode && req.status === 'pending') {
      showDeleteTimeRequest(req.from, req.minutes, req.id);
    }
    if (req.status === 'rejected') {
      document.getElementById('deleteRequestBanner')?.remove();
      if (req.from === myCode) showInAppNotif('상대방이 변경을 거부했습니다');
    }
    if (req.status === 'approved') {
      document.getElementById('deleteRequestBanner')?.remove();
      autoDeleteMinutes = req.minutes;
      localStorage.setItem('autoDeleteMin', autoDeleteMinutes);
      updateAutoDeleteLabel();
    }
  });
}

function showDeleteTimeRequest(from, minutes, reqId) {
  document.getElementById('deleteRequestBanner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'deleteRequestBanner'; banner.className = 'delete-request-banner';
  banner.innerHTML = `<div class="drb-text">${from}님이 자동삭제 시간을 <b>${minutes}분</b>으로 변경 요청</div>
    <div class="drb-btns">
      <button class="drb-accept" onclick="respondDeleteRequest(true,'${reqId}',${minutes})">동의</button>
      <button class="drb-reject" onclick="respondDeleteRequest(false,'${reqId}',${minutes})">거부</button>
    </div>`;
  document.getElementById('activeChatView').insertBefore(banner, document.getElementById('messageList'));
}

async function respondDeleteRequest(accept, reqId, minutes) {
  document.getElementById('deleteRequestBanner')?.remove();
  if (accept) {
    autoDeleteMinutes = minutes;
    localStorage.setItem('autoDeleteMin', minutes);
    updateAutoDeleteLabel();
    await db.collection('rooms').doc(chatRoomId).update({ 'deleteRequest.status': 'approved' });
  } else {
    await db.collection('rooms').doc(chatRoomId).update({ 'deleteRequest.status': 'rejected' });
  }
}

let seenMsgIds = new Set();
let firstLoad = true;

function listenMessages() {
  // 기존 리스너 완전 정리
  if (messageListener) { messageListener(); messageListener = null; }
  Object.values(deleteTimers).forEach(t => clearTimeout(t)); deleteTimers = {};
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};

  seenMsgIds = new Set();
  firstLoad = true;

  messageListener = db.collection('rooms').doc(chatRoomId).collection('messages').orderBy('ts')
    .onSnapshot(snap => {
      const list = document.getElementById('messageList');
      if (!list) return;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

      // 새 메시지 알림 (첫 로드 이후, 상대방 메시지만)
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const id = change.doc.id;
          if (!firstLoad && data.sender !== myCode && data.type !== 'system' && !seenMsgIds.has(id)) {
            // 앱이 백그라운드일 때만 알림
            if (document.visibilityState !== 'visible' && notifEnabled && Notification.permission === 'granted') {
              sendNotification('📅 일정 알림', '새 일정이 있어요');
              unreadCount++;
              setBadge(unreadCount);
            }
          }
          seenMsgIds.add(id);
        }
      });

      // 카운트다운 타이머 정리 후 재시작
      Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};

      list.innerHTML = '';
      snap.forEach(doc => {
        renderMessage(doc.data(), doc.id);
        // 삭제 타이머는 아직 없는 것만 등록
        if (!deleteTimers[doc.id]) scheduleAutoDelete(doc.id, doc.data());
      });
      if (atBottom) list.scrollTop = list.scrollHeight;

      firstLoad = false;
    });
}

function renderMessage(data, id) {
  const list = document.getElementById('messageList');
  const mine = data.sender === myCode;
  if (data.type === 'system') {
    const sysDiv = document.createElement('div');
    sysDiv.className = 'msg-bubble system-msg';
    sysDiv.textContent = data.text;
    list.appendChild(sysDiv);
    return;
  }

  // 컨테이너 (시간 + 말풍선 가로 배치)
  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'msg-row-mine' : 'msg-row-theirs'}`;

  // 말풍선
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${mine ? 'mine' : 'theirs'}`;
  bubble.style.fontSize = (localStorage.getItem('chatFontSize') || '18') + 'px';
  if (data.type === 'image') {
    bubble.classList.add('media-bubble');
    const img = document.createElement('img');
    img.src = data.url; img.className = 'msg-media';
    img.onclick = () => window.open(data.url, '_blank');
    bubble.appendChild(img);
  } else if (data.type === 'video') {
    bubble.classList.add('media-bubble');
    const vid = document.createElement('video');
    vid.src = data.url; vid.controls = true; vid.className = 'msg-media';
    bubble.appendChild(vid);
  } else {
    bubble.textContent = data.text;
  }

  // 시간+카운트다운
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const sent = document.createElement('div'); sent.className = 'msg-time';
  const d = data.ts?.toDate ? data.ts.toDate() : new Date();
  sent.textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const cd = document.createElement('div'); cd.className = 'msg-countdown'; cd.id = 'cd-' + id;
  meta.appendChild(sent); meta.appendChild(cd);

  // 내 메시지: 시간 - 말풍선 / 상대 메시지: 말풍선 - 시간
  if (mine) { row.appendChild(meta); row.appendChild(bubble); }
  else { row.appendChild(bubble); row.appendChild(meta); }

  list.appendChild(row);
  startCountdown(id, data.deleteAt);
}

function startCountdown(msgId, deleteAt) {
  if (countdownTimers[msgId]) clearInterval(countdownTimers[msgId]);
  if (!deleteAt) {
    // 아직 읽지 않음
    const el = document.getElementById('cd-' + msgId);
    if (el) el.textContent = '';
    return;
  }
  const target = deleteAt.toMillis ? deleteAt.toMillis() : deleteAt;
  function tick() {
    const el = document.getElementById('cd-' + msgId);
    if (!el) { clearInterval(countdownTimers[msgId]); return; }
    const rem = Math.max(0, target - Date.now());
    el.textContent = rem > 0 ? `${Math.floor(rem/60000)}:${String(Math.floor((rem%60000)/1000)).padStart(2,'0')}` : '';
    if (rem <= 0) clearInterval(countdownTimers[msgId]);
  }
  tick(); countdownTimers[msgId] = setInterval(tick, 1000);
}

// 채팅창 열면 상대방 메시지에 deleteAt 설정 (읽음 처리)
async function markMessagesRead() {
  if (!chatRoomId || !myCode) return;
  const snap = await db.collection('rooms').doc(chatRoomId).collection('messages')
    .where('receiverId', '==', myCode)
    .where('deleteAt', '==', null)
    .get();
  if (snap.empty) return;
  const batch = db.batch();
  const deleteAt = firebase.firestore.Timestamp.fromMillis(Date.now() + autoDeleteMinutes * 60000);
  snap.docs.forEach(doc => batch.update(doc.ref, { deleteAt }));
  await batch.commit().catch(() => {});
}

function scheduleAutoDelete(msgId, data) {
  if (!data.deleteAt) return; // 아직 읽지 않음 → 타이머 없음
  if (deleteTimers[msgId]) return;
  const target = data.deleteAt.toMillis();
  const delay = Math.max(0, target - Date.now());
  deleteTimers[msgId] = setTimeout(() => {
    db.collection('rooms').doc(chatRoomId).collection('messages').doc(msgId).delete().catch(() => {});
    delete deleteTimers[msgId];
  }, delay);
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file || !chatRoomId) return;
  e.target.value = '';
  const isVideo = file.type.startsWith('video');
  const isImage = file.type.startsWith('image');
  if (!isVideo && !isImage) { alert('이미지 또는 영상만 전송 가능합니다'); return; }

  // 인증 완료까지 대기
  if (!currentUser) {
    showInAppNotif('인증 중...');
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (currentUser) { clearInterval(check); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
  }

  if (!currentUser) { alert('인증 실패 - 새로고침 후 다시 시도하세요'); return; }

  showInAppNotif('업로드 중...');
  try {
    const path = `media/${chatRoomId}/${Date.now()}`;
    const ref = storage.ref().child(path);
    const snap = await ref.put(file);
    const url = await snap.ref.getDownloadURL();
    await db.collection('rooms').doc(chatRoomId).collection('messages').add({
      sender: myCode, receiverId: activeFriendCode,
      type: isVideo ? 'video' : 'image',
      url, storagePath: path,
      ts: firebase.firestore.Timestamp.now(),
      deleteAt: null  // 상대방이 읽으면 카운트 시작
    });
    showInAppNotif('전송 완료!');
    // 상대방 FCM 푸시
    const friendSnap = await db.collection('users').doc(activeFriendCode).get();
    if (friendSnap.exists && friendSnap.data().fcmToken) {
      sendFCMPush(friendSnap.data().fcmToken);
    }
  } catch(err) {
    alert('전송 실패: ' + err.message);
  }
}

async function sendMessage() {
  const input = document.getElementById('msgInput'); const text = input.value.trim();
  if (!text || !chatRoomId) return; input.value = '';
  await db.collection('rooms').doc(chatRoomId).collection('messages').add({
    sender: myCode, receiverId: activeFriendCode, text, type: 'text',
    ts: firebase.firestore.Timestamp.now(),
    deleteAt: null
  });
  // 상대방 FCM 토큰 조회 후 푸시
  const friendSnap = await db.collection('users').doc(activeFriendCode).get();
  if (friendSnap.exists && friendSnap.data().fcmToken) {
    sendFCMPush(friendSnap.data().fcmToken);
  }
}

async function deleteAllNow() {
  if (!chatRoomId) return;
  if (!confirm('모든 채팅을 즉시 삭제합니다. 복구 불가입니다.')) return;
  const snap = await db.collection('rooms').doc(chatRoomId).collection('messages').get();
  const batch = db.batch();
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.storagePath) storage.ref(data.storagePath).delete().catch(() => {});
    batch.delete(d.ref);
  });
  await batch.commit();
  Object.values(deleteTimers).forEach(t => clearTimeout(t)); deleteTimers = {};
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};
}

function openTimerSetting() { document.getElementById('timerModal').style.display = 'flex'; }
function closeTimerModal() { document.getElementById('timerModal').style.display = 'none'; }
async function setAutoDelete(min) {
  closeTimerModal();
  if (!chatRoomId) {
    autoDeleteMinutes = min; localStorage.setItem('autoDeleteMin', min); updateAutoDeleteLabel(); return;
  }
  const reqId = Date.now().toString();
  await db.collection('rooms').doc(chatRoomId).set({
    deleteRequest: { from: myCode, minutes: min, id: reqId, status: 'pending', appliedTo: [], ts: firebase.firestore.Timestamp.now() }
  }, { merge: true });
  // 요청자는 승인 대기 - 아직 변경 안 함
  showInAppNotif('상대방 승인 대기 중...');
}
function updateAutoDeleteLabel() { document.getElementById('autoDeleteLabel').textContent = `자동삭제: ${autoDeleteMinutes}분`; }

// ── SECRET SETTINGS ──────────────────────────────────
function setChatFontSize(size) {
  localStorage.setItem('chatFontSize', size);
  applyChatFontSize();
  updateFontSizeBtns();
}

function applyChatFontSize() {
  const size = parseInt(localStorage.getItem('chatFontSize') || '18');
  document.querySelectorAll('.msg-bubble').forEach(el => el.style.fontSize = size + 'px');
  document.querySelector('#chatApp .msg-input') && (document.getElementById('msgInput').style.fontSize = size + 'px');
}

function updateFontSizeBtns() {
  const size = parseInt(localStorage.getItem('chatFontSize') || '18');
  document.querySelectorAll('.font-size-btn').forEach(btn => {
    const s = btn.textContent === '소' ? 12 : btn.textContent === '중' ? 15 : 18;
    btn.style.background = s === size ? '#3b82f6' : '#0f172a';
  });
}

function setChatTheme(theme) {
  localStorage.setItem('chatTheme', theme);
  applyChatTheme();
  updateThemeBtns();
}

function applyChatTheme() {
  const theme = localStorage.getItem('chatTheme') || 'dark';
  const chatApp = document.getElementById('chatApp');
  const patternSetup = document.getElementById('patternSetup');
  if (theme === 'light') {
    chatApp.classList.add('chat-light');
    patternSetup.classList.add('chat-light');
  } else {
    chatApp.classList.remove('chat-light');
    patternSetup.classList.remove('chat-light');
  }
}

function updateThemeBtns() {
  const theme = localStorage.getItem('chatTheme') || 'dark';
  document.getElementById('themeDarkBtn')?.classList.toggle('theme-active', theme === 'dark');
  document.getElementById('themeLightBtn')?.classList.toggle('theme-active', theme === 'light');
}

function updateFontSizeBtns() {
  const size = parseInt(localStorage.getItem('chatFontSize') || '18');
  const map = { 'fontSmBtn': 14, 'fontMdBtn': 18, 'fontLgBtn': 22 };
  Object.entries(map).forEach(([id, s]) => {
    document.getElementById(id)?.classList.toggle('font-active', s === size);
  });
}

function openSecretSettings() {
  document.getElementById('myCodeDisplaySettings').textContent = myCode;
  updateNotifBtn();
  updateFontSizeBtns();
  updateThemeBtns();
  document.getElementById('secretSettingsModal').style.display = 'flex';
}
function closeSecretSettings() { document.getElementById('secretSettingsModal').style.display = 'none'; }

// ── NOTIFICATIONS (in-app only) ─────────────────────
let notifEnabled = localStorage.getItem('notifEnabled') === 'true';
let swReg = null;

// SW 준비
async function getSW() {
  if (swReg) return swReg;
  if ('serviceWorker' in navigator) swReg = await navigator.serviceWorker.ready;
  return swReg;
}

const VAPID_KEY = 'BFsKaZKglqdWpCOkCgp39gkMlGcKq1aHSEkueZjhsojj65HfAPMoL9_sKhTz6NjgXCjtNv0plJVIj9S8I7r4XR8';
const FCM_SERVER = 'https://fcm-server-xlrl.onrender.com';

let fcmToken = localStorage.getItem('fcmToken') || null;
let messaging = null;

// FCM 초기화 및 토큰 발급
async function initFCM() {
  try {
    if (typeof firebase.messaging === 'undefined') return;
    if (!firebase.messaging.isSupported()) return;
    messaging = firebase.messaging();
    const sw = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
    if (token && token !== fcmToken) {
      fcmToken = token;
      localStorage.setItem('fcmToken', token);
      if (myCode) await db.collection('users').doc(myCode).set({ fcmToken: token }, { merge: true });
    }
  } catch(e) {
    console.log('FCM init error:', e.message);
  }
}

// Render 서버로 FCM 푸시 전송
async function sendFCMPush(targetToken) {
  if (!targetToken) return;
  try {
    await fetch(`${FCM_SERVER}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken, title: '📅 일정 알림', body: '새 일정이 있어요' })
    });
  } catch(e) {
    console.log('Push error:', e.message);
  }
}
  if (!notifEnabled) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const now = Date.now();
  if (now - lastNotifTime < 3000) return; // 3초 내 중복 방지
  lastNotifTime = now;
  const sw = await getSW();
  if (sw) sw.active?.postMessage({ type: 'SHOW_NOTIFICATION', title, body });
}

// 배지 숫자 설정
async function setBadge(count) {
  const sw = await getSW();
  if (sw) sw.active?.postMessage({ type: count > 0 ? 'SET_BADGE' : 'CLEAR_BADGE', count });
}

let unreadCount = 0;

function toggleNotification() {
  if (typeof Notification === 'undefined') { alert('이 브라우저는 알림을 지원하지 않습니다'); return; }
  if (Notification.permission === 'denied') { alert('알림이 차단되어 있습니다.\n브라우저 설정에서 직접 허용해주세요.'); return; }
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') { notifEnabled = true; localStorage.setItem('notifEnabled', 'true'); updateNotifBtn(); }
    });
    return;
  }
  notifEnabled = !notifEnabled;
  localStorage.setItem('notifEnabled', notifEnabled);
  updateNotifBtn();
}

function updateNotifBtn() {
  const btn = document.getElementById('notifToggleBtn');
  if (!btn) return;
  notifEnabled = localStorage.getItem('notifEnabled') === 'true';
  btn.textContent = notifEnabled ? '🔔 알림 켜짐' : '🔕 알림 꺼짐';
  btn.style.background = notifEnabled ? '#22c55e' : '#475569';
}

function showInAppNotif(text) {
  let el = document.getElementById('inAppNotif');
  if (!el) { el = document.createElement('div'); el.id = 'inAppNotif'; el.className = 'in-app-notif'; document.body.appendChild(el); }
  el.textContent = '🔔 ' + text; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}
