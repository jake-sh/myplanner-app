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
let messageListener = null, friendsListener = null, roomListener = null, calListener = null, todoListener = null;
let deleteTimers = {}, countdownTimers = {}, qrScanner = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let editingMemoIndex = null;

// ── INIT ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  updateFakeDate();
  const n = localStorage.getItem('appName');
  if (n) { document.getElementById('appTitle').textContent = n; document.title = n; }
  const t = localStorage.getItem('themeColor');
  if (t) { document.documentElement.style.setProperty('--primary', t); setTimeout(function(){ applyMenuTheme(t); }, 100); }
  showScreen('fakeApp');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

function updateFakeDate() {
  const d = new Date(), days = ['일','월','화','수','목','금','토'];
  var lang = localStorage.getItem('lang') || 'ko';
  if (lang === 'en') {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var daysEn = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    document.getElementById('fakeDate').textContent = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' (' + daysEn[d.getDay()] + ')';
  } else {
    document.getElementById('fakeDate').textContent = d.getFullYear() + '년 ' + (d.getMonth()+1) + '월 ' + d.getDate() + '일 (' + days[d.getDay()] + ')';
  }
}

// ── SCREEN ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id !== 'fakeApp') {
    history.pushState({ screen: id }, '', '');
  }
}

window.addEventListener('popstate', function(e) {
  // 뒤로가기 누르면 메인 화면으로
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('fakeApp').classList.add('active');
});

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

let _tapStartDot = -1;

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
  const patternCopy = [...currentPattern];
  clearDots();
  currentPattern = [];

  // 탭 = 1개 또는 같은 dot만 반복된 경우 (미세한 움직임 허용)
  const uniqueDots = [...new Set(patternCopy)];
  if (uniqueDots.length <= 1) {
    openFeature(tapped);
  } else if (arraysEqual(patternCopy, savedPattern)) {
    enterChatApp();
  }
  // else: 잘못된 패턴 → 아무것도 안 함
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
  else if (i === 5) openStats();
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
  // 알림 토글 초기화
  document.getElementById('notifApp').checked = localStorage.getItem('notifApp') === 'true';
  document.getElementById('notifCal').checked = localStorage.getItem('notifCal') === 'true';
  document.getElementById('notifTodo').checked = localStorage.getItem('notifTodo') === 'true';
  showScreen('settingsScreen');
}
function saveAppName() {
  const n = document.getElementById('appNameInput').value.trim() || 'MyPlanner';
  localStorage.setItem('appName', n);
  document.getElementById('appTitle').textContent = n;
  document.title = n;
  alert('저장되었습니다');
}
function setTheme(c) {
  document.documentElement.style.setProperty('--primary', c);
  localStorage.setItem('themeColor', c);
  applyMenuTheme(c);
}

function applyMenuTheme(c) {
  var isGray = (c === '#6b7280');
  var items = document.querySelectorAll('.menu-item');
  var pastelColors = [
    '#E8F8F5','#E8F4FF','#FFE8EE','#FFF8E8',
    '#FFF0E8','#EDFBF0','#EEE8FF','#F5E8FF','#E8EEFF'
  ];
  items.forEach(function(item, i) {
    if (isGray) {
      item.style.background = '#F0F1F4';
    } else {
      item.style.background = pastelColors[i] || '#fff';
    }
  });
}

// ── 할 일 ───────────────────────────────────────────
function getSharedTodoId() {
  const f = JSON.parse(localStorage.getItem('friends') || '[]');
  if (!myCode || !f.length) return null;
  return [myCode, f[0]].sort().join('_todo_');
}

function openTodo() {
  showScreen('todoScreen');
  if (todoListener) { todoListener(); todoListener = null; }
  const sid = getSharedTodoId();
  if (sid) {
    let firstLoad = true;
    
    todoListener = db.collection('todos').doc(sid).onSnapshot(snap => {
      if (snap.exists) {
        const data = snap.data();
        localStorage.setItem('todos', JSON.stringify(data.todos || []));
        if (!firstLoad && data.updatedBy && data.updatedBy !== myCode) {
          if (localStorage.getItem('notifTodo') === 'true') sendNotification('할 일', '새로운 할 일이 있어요');
        }
        firstLoad = false;
      }
      
      renderTodoList();
    });
  } else {
    
    renderTodoList();
  }
}

async function saveTodosToFirestore() {
  const sid = getSharedTodoId();
  console.log('[TODO] sid:', sid, 'myCode:', myCode, 'friends:', localStorage.getItem('friends'));
  if (!sid) return;
  const todos = JSON.parse(localStorage.getItem('todos') || '[]');
  try {
    await db.collection('todos').doc(sid).set({ todos, updatedBy: myCode, ts: firebase.firestore.Timestamp.now() });
  } catch(e) {
    console.log('[TODO] save error:', e.message);
  }
}

function renderTodoList() {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]');
  document.getElementById('todoCount').textContent = `${todos.filter(t=>t.done).length}/${todos.length}`;
  const el = document.getElementById('todoList');
  if (!todos.length) { el.innerHTML = '<div class="empty-state">📋<br/>' + (localStorage.getItem("lang")==="en" ? 'No tasks yet' : '할 일이 없습니다') + '</div>'; return; }
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
  saveTodosToFirestore();
}
function toggleTodo(i) {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]'); todos[i].done = !todos[i].done;
  localStorage.setItem('todos', JSON.stringify(todos)); renderTodoList();
  saveTodosToFirestore();
}
function deleteTodo(i) {
  const todos = JSON.parse(localStorage.getItem('todos') || '[]'); todos.splice(i,1);
  localStorage.setItem('todos', JSON.stringify(todos)); renderTodoList();
  saveTodosToFirestore();
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
          if (localStorage.getItem('notifCal') === 'true') sendNotification('달력', '새 일정이 있어요');
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
  var calLang = localStorage.getItem('lang') || 'ko';
  if (calLang === 'en') {
    var enMonths = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('calTitle').textContent = enMonths[calMonth] + ' ' + calYear;
  } else {
    document.getElementById('calTitle').textContent = calYear + '년 ' + months[calMonth];
  }
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
  applyChatFontSize();
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
    el.innerHTML = '<div class="no-friend"><div class="big-icon">👤</div><div>' + (localStorage.getItem('lang')==='en' ? 'Add a friend to start chatting' : '친구를 추가하면 채팅이 시작됩니다') + '</div></div>';
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
  const tabMap = { 'code': 'tabCode', 'qr': 'tabQRScan', 'myqr': 'tabMyQR' };
  ['code','qr','myqr'].forEach(t => {
    document.getElementById('addTab' + t[0].toUpperCase() + t.slice(1)).style.display = 'none';
    document.getElementById(tabMap[t]).classList.remove('active');
  });
  const el = document.getElementById('addTab' + tab[0].toUpperCase() + tab.slice(1));
  el.style.display = tab === 'myqr' ? 'flex' : 'block';
  document.getElementById(tabMap[tab]).classList.add('active');
  if (tab === 'myqr') renderMyQr();
  else if (tab === 'qr') startQrScanner();
  else stopQrScanner();
}

async function addFriendByCode() {
  const code = document.getElementById('friendCodeInput').value.trim().toUpperCase();
  if (!code) { alert(localStorage.getItem('lang')==='en' ? 'Please enter a code' : '코드를 입력하세요'); return; }
  if (code === myCode) { alert(localStorage.getItem('lang')==='en' ? 'You cannot add yourself' : '자신의 코드는 추가할 수 없습니다'); return; }
  if (friends.includes(code)) { alert(localStorage.getItem('lang')==='en' ? 'Already added' : '이미 추가된 친구입니다'); return; }

  // 존재하는 사용자인지 확인
  const snap = await db.collection('users').doc(code).get();
  if (!snap.exists) { alert(`"${code}" 는 등록되지 않은 사용자예요`); return; }

  friends.push(code); localStorage.setItem('friends', JSON.stringify(friends));
  await db.collection('users').doc(myCode).set({ friends: firebase.firestore.FieldValue.arrayUnion(code) }, { merge: true });
  await db.collection('users').doc(code).set({ friends: firebase.firestore.FieldValue.arrayUnion(myCode) }, { merge: true });
  renderFriendList(); closeAddFriend(); alert(localStorage.getItem('lang')==='en' ? code + ' has been added' : code + ' 추가되었습니다');
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
      renderFriendList(); closeAddFriend(); alert(localStorage.getItem('lang')==='en' ? code + ' has been added' : code + ' 추가되었습니다');
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
      let hasNewMsg = false;
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const id = change.doc.id;
          if (!firstLoad && data.sender !== myCode && data.type !== 'system' && !seenMsgIds.has(id)) {
            hasNewMsg = true;
            // FCM 토큰 없을 때만 SW 로컬 알림 (FCM 있으면 FCM이 알림 처리)
            if (document.visibilityState !== 'visible' && notifEnabled && Notification.permission === 'granted' && !fcmToken) {
              sendNotification('새 메시지', '새 알림이 있어요');
              unreadCount++;
              setBadge(unreadCount);
            }
          }
          seenMsgIds.add(id);
        }
      });
      // 채팅창 열려있는 상태에서 새 메시지 오면 즉시 읽음 처리 → 카운트 시작
      if (hasNewMsg) markMessagesRead();

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
  if (data.type === 'album' && data.urls && data.urls.length > 0) {
    bubble.classList.add('media-bubble');
    const urls = data.urls;
    const grid = document.createElement('div');
    const cols = urls.length <= 2 ? urls.length : urls.length <= 4 ? 2 : 3;
    grid.style.cssText = 'display:grid;grid-template-columns:repeat('+cols+',1fr);gap:3px;border-radius:12px;overflow:hidden;max-width:240px;';
    urls.forEach((url, i) => {
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;cursor:pointer;';
      img.onclick = () => openImgViewer(urls, i);
      grid.appendChild(img);
    });
    bubble.appendChild(grid);
  } else if (data.type === 'image') {
    bubble.classList.add('media-bubble');
    const img = document.createElement('img');
    img.src = data.url; img.className = 'msg-media';
    img.onclick = () => openImgViewer([data.url], 0);
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
    const el = document.getElementById('cd-' + msgId);
    if (el) el.textContent = '';
    return;
  }
  const target = deleteAt.toMillis ? deleteAt.toMillis() : deleteAt;
  function tick() {
    const el = document.getElementById('cd-' + msgId);
    if (!el) { clearInterval(countdownTimers[msgId]); return; }
    const rem = Math.max(0, target - Date.now());
    if (rem <= 0) {
      clearInterval(countdownTimers[msgId]);
      // 화면에서 제거
      const row = el.closest('.msg-row');
      if (row) row.remove();
      // Firestore에서도 즉시 삭제
      if (chatRoomId) {
        db.collection('rooms').doc(chatRoomId).collection('messages').doc(msgId).delete().catch(() => {});
      }
      return;
    }
    el.textContent = `${Math.floor(rem/60000)}:${String(Math.floor((rem%60000)/1000)).padStart(2,'0')}`;
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
  const files = Array.from(e.target.files);
  if (!files.length || !chatRoomId) return;
  e.target.value = '';

  // 인증 대기
  if (!currentUser) {
    await new Promise((resolve) => {
      const check = setInterval(() => { if (currentUser) { clearInterval(check); resolve(); } }, 200);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });
  }
  if (!currentUser) { alert('인증 실패 - 새로고침 후 다시 시도하세요'); return; }

  // 단일 파일
  if (files.length === 1) {
    const file = files[0];
    const isVideo = file.type.startsWith('video');
    const isImage = file.type.startsWith('image');
    if (!isVideo && !isImage) { alert('이미지 또는 영상만 전송 가능합니다'); return; }
    showUploadStatus('업로드 중...');
    try {
      const path = `media/${chatRoomId}/${Date.now()}`;
      const snap = await storage.ref().child(path).put(file);
      const url = await snap.ref.getDownloadURL();
      await db.collection('rooms').doc(chatRoomId).collection('messages').add({
        sender: myCode, receiverId: activeFriendCode,
        type: isVideo ? 'video' : 'image',
        url, storagePath: path,
        ts: firebase.firestore.Timestamp.now(), deleteAt: null
      });
      hideUploadStatus();
      const friendSnap = await db.collection('users').doc(activeFriendCode).get();
      if (friendSnap.exists && friendSnap.data().fcmToken) sendFCMPush(friendSnap.data().fcmToken);
    } catch(err) { hideUploadStatus(); alert('전송 실패: ' + err.message); }
    return;
  }

  // 다중 파일 - 앨범으로 묶어서 전송
  const imageFiles = files.filter(f => f.type.startsWith('image'));
  if (!imageFiles.length) { alert('이미지만 묶음 전송 가능합니다'); return; }
  if (imageFiles.length > 10) { alert('최대 10장까지 선택 가능합니다'); return; }

  showUploadStatus(`업로드 중... (0/${imageFiles.length})`);
  try {
    const urls = [];
    const paths = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const path = `media/${chatRoomId}/${Date.now()}_${i}`;
      const snap = await storage.ref().child(path).put(imageFiles[i]);
      urls.push(await snap.ref.getDownloadURL());
      paths.push(path);
      showUploadStatus(`업로드 중... (${i+1}/${imageFiles.length})`);
    }
    await db.collection('rooms').doc(chatRoomId).collection('messages').add({
      sender: myCode, receiverId: activeFriendCode,
      type: 'album', urls, storagePaths: paths,
      ts: firebase.firestore.Timestamp.now(), deleteAt: null
    });
    hideUploadStatus();
    const friendSnap = await db.collection('users').doc(activeFriendCode).get();
    if (friendSnap.exists && friendSnap.data().fcmToken) sendFCMPush(friendSnap.data().fcmToken);
  } catch(err) { hideUploadStatus(); alert('전송 실패: ' + err.message); }
}

async function sendMessage() {
  const input = document.getElementById('msgInput'); const text = input.value.trim();
  if (!text || !chatRoomId) return; input.value = '';
  // 키패드 유지 - 포커스 즉시 복원
  input.focus();
  await db.collection('rooms').doc(chatRoomId).collection('messages').add({
    sender: myCode, receiverId: activeFriendCode, text, type: 'text',
    ts: firebase.firestore.Timestamp.now(),
    deleteAt: null
  });
  // 상대방 FCM 토큰 조회 후 푸시
  try {
    const friendSnap = await db.collection('users').doc(activeFriendCode).get();
    if (friendSnap.exists && friendSnap.data().fcmToken) {
      sendFCMPush(friendSnap.data().fcmToken, '새 메시지', '새 알림이 있어요');
    }
  } catch(e) { console.log('push error:', e.message); }
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
  const input = document.getElementById('msgInput');
  if (input) input.style.fontSize = size + 'px';
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
  const en = localStorage.getItem('lang') === 'en';
  var d = document.getElementById('themeDarkBtn');
  var l = document.getElementById('themeLightBtn');
  if(d) { d.classList.toggle('theme-active', theme === 'dark'); d.textContent = en ? 'Dark' : '다크'; }
  if(l) { l.classList.toggle('theme-active', theme === 'light'); l.textContent = en ? 'Light' : '라이트'; }
}

function updateFontSizeBtns() {
  const size = parseInt(localStorage.getItem('chatFontSize') || '18');
  const en = localStorage.getItem('lang') === 'en';
  const map = { 'fontSmBtn': 14, 'fontMdBtn': 18, 'fontLgBtn': 22 };
  const labels = { 'fontSmBtn': en?'S':'소', 'fontMdBtn': en?'M':'중', 'fontLgBtn': en?'L':'대' };
  Object.entries(map).forEach(([id, s]) => {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('font-active', s === size); el.textContent = labels[id]; }
  });
  var sl = document.getElementById('fontSmLabel'); if(sl) sl.textContent = en?'S':'소';
  var ml = document.getElementById('fontMdLabel'); if(ml) ml.textContent = en?'M':'중';
  var ll = document.getElementById('fontLgLabel'); if(ll) ll.textContent = en?'L':'대';
}

function toggleAutoLock(enabled) {
  localStorage.setItem('autoLock', enabled ? 'true' : 'false');
}

function openSecretSettings() {
  document.getElementById('myCodeDisplaySettings').textContent = myCode;
  updateNotifBtn();
  updateFontSizeBtns();
  updateThemeBtns();
  var autoLockEl = document.getElementById('autoLockToggle');
  if (autoLockEl) autoLockEl.checked = localStorage.getItem('autoLock') === 'true';
  document.getElementById('secretSettingsModal').style.display = 'flex';
}
function closeSecretSettings() { document.getElementById('secretSettingsModal').style.display = 'none'; }

// ── NOTIFICATIONS (in-app only) ─────────────────────
let notifEnabled = localStorage.getItem('notifEnabled') === 'true';
let swReg = null;

// SW 준비
// 앱 열리거나 포커스 될 때 알림 자동 닫기
async function clearAllNotifications() {
  // SW postMessage 방식
  const sw = await getSW();
  if (sw && sw.active) {
    sw.active.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
  }
  // 직접 Notification API로도 닫기 (iOS 대응)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const notifs = await reg.getNotifications();
        notifs.forEach(n => n.close());
      }
    } catch(e) {}
  }
}

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    clearAllNotifications();
    setBadge(0);
    unreadCount = 0;
    // 강화 보안 - 채팅창 이탈 후 복귀 시 자동 잠금
    if (localStorage.getItem('autoLock') === 'true') {
      var activeScreen = document.querySelector('.screen.active');
      if (activeScreen && (activeScreen.id === 'chatApp')) {
        exitChat();
      }
    }
  } else {
    // 화면 숨겨질 때 강화 보안 적용
    if (localStorage.getItem('autoLock') === 'true') {
      var activeScreen = document.querySelector('.screen.active');
      if (activeScreen && activeScreen.id === 'chatApp') {
        exitChat();
      }
    }
  }
});

window.addEventListener('focus', function() {
  clearAllNotifications();
  setBadge(0);
  unreadCount = 0;
});

// 앱 처음 로드 시에도 클리어
clearAllNotifications();

async function getSW() {
  if (swReg) return swReg;
  if ('serviceWorker' in navigator) swReg = await navigator.serviceWorker.ready;
  return swReg;
}

const VAPID_KEY = 'BFsKaZKglqdWpCOkCgp39gkMlGcKq1aHSEkueZjhsojj65HfAPMoL9_sKhTz6NjgXCjtNv0plJVIj9S8I7r4XR8';
const FCM_SERVER = 'https://sendpush-zd5g5jmsha-uc.a.run.app';

let fcmToken = localStorage.getItem('fcmToken') || null;
let messaging = null;

// FCM 초기화 및 토큰 발급
async function initFCM() {
  try {
    if (typeof firebase !== 'undefined' && firebase.messaging && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
      messaging = firebase.messaging();
      const sw = await navigator.serviceWorker.ready;
      const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
      if (token) {
        fcmToken = token;
        localStorage.setItem('fcmToken', token);
        if (myCode) await db.collection('users').doc(myCode).set({ fcmToken: token }, { merge: true });
        console.log('FCM token saved');
      }
    } else {
      // FCM 미지원 (iOS 등) - fcmToken 없이 SW postMessage 방식만 사용
      console.log('FCM not supported, using SW notifications only');
    }
  } catch(e) {
    console.log('FCM init error:', e.message);
  }
}

// Render 서버로 FCM 푸시 전송
async function sendFCMPush(targetToken, title = '새 메시지', body = '새 알림이 있어요') {
  if (!targetToken) return;
  try {
    await fetch(`${FCM_SERVER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken, title, body })
    });
  } catch(e) {
    console.log('Push error:', e.message);
  }
}

let lastNotifTime = 0;
// 로컬 알림 표시 (iOS/Android 공통)
async function sendNotification(title, body) {
  if (!notifEnabled) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  // 중복 방지 (3초 내 같은 알림 차단)
  const now = Date.now();
  if (now - lastNotifTime < 3000) return;
  lastNotifTime = now;
  const sw = await getSW();
  if (sw && sw.active) {
    sw.active.postMessage({ type: 'SHOW_NOTIFICATION', title, body });
  } else {
    new Notification(title, { body, icon: '/myplanner-app/icons/icon-192.png' });
  }
}

// showPushNotification merged into sendNotification

// 배지 숫자 설정
async function setBadge(count) {
  const sw = await getSW();
  if (sw) sw.active?.postMessage({ type: count > 0 ? 'SET_BADGE' : 'CLEAR_BADGE', count });
}

let unreadCount = 0;

// 설정 화면 알림 토글
async function toggleSettingsNotif(type, enabled) {
  if (enabled) {
    // 권한 요청
    if (typeof Notification === 'undefined') {
      alert('이 브라우저는 알림을 지원하지 않습니다');
      document.getElementById('notif' + type.charAt(0).toUpperCase() + type.slice(1)).checked = false;
      return;
    }
    if (Notification.permission === 'denied') {
      alert('알림이 차단되어 있습니다.\n브라우저/시스템 설정에서 직접 허용해주세요.');
      document.getElementById('notif' + type.charAt(0).toUpperCase() + type.slice(1)).checked = false;
      return;
    }
    if (Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        document.getElementById('notif' + type.charAt(0).toUpperCase() + type.slice(1)).checked = false;
        return;
      }
    }
    // SW 등록 확인
    await getSW();
  }
  localStorage.setItem('notif' + type.charAt(0).toUpperCase() + type.slice(1), enabled);
  // notifEnabled는 앱알림 토글과 동기화
  if (type === 'app') {
    notifEnabled = enabled;
    localStorage.setItem('notifEnabled', enabled);
  }
}

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

function showUploadStatus(text) {
  let el = document.getElementById('uploadStatus');
  if (!el) { el = document.createElement('div'); el.id = 'uploadStatus'; document.body.appendChild(el); }
  el.textContent = text;
  el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#fff;padding:6px 16px;border-radius:20px;font-size:13px;z-index:9999;';
  el.style.display = 'block';
}
function hideUploadStatus() {
  const el = document.getElementById('uploadStatus');
  if (el) el.style.display = 'none';
}

function showInAppNotif(text) {
  let el = document.getElementById('inAppNotif');
  if (!el) { el = document.createElement('div'); el.id = 'inAppNotif'; el.className = 'in-app-notif'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3000);
}



// -- Health Stats --
var STAT_CATS = {
  weight:     { label: "체중",   labelEn: "Weight",      unit: "kg",    color: "#4A90D9", emoji: "⚖️" },
  bp_sys:     { label: "혈압수", labelEn: "BP(sys)",     unit: "mmHg",  color: "#ef4444", emoji: "🫀" },
  bp_dia:     { label: "혈압이", labelEn: "BP(dia)",     unit: "mmHg",  color: "#f97316", emoji: "🫀" },
  blood_sugar:{ label: "혈당",   labelEn: "Blood Sugar", unit: "mg/dL", color: "#a855f7", emoji: "🩸" },
  sleep:      { label: "수면",   labelEn: "Sleep",       unit: "h",     color: "#6366f1", emoji: "😴" },
  steps:      { label: "걸음",   labelEn: "Steps",       unit: "steps", color: "#22c55e", emoji: "🚶" },
  water:      { label: "물",     labelEn: "Water",       unit: "L",     color: "#06b6d4", emoji: "💧" },
  exercise:   { label: "운동",   labelEn: "Exercise",    unit: "min",   color: "#f59e0b", emoji: "🏃" }
};

function statLabel(k) {
  var en = localStorage.getItem('lang') === 'en';
  return en ? (STAT_CATS[k].labelEn || STAT_CATS[k].label) : STAT_CATS[k].label;
}
function statUnit(k) {
  var en = localStorage.getItem('lang') === 'en';
  if (!en) return STAT_CATS[k].unit;
  // 영문 단위 매핑
  var unitMap = { '보': 'steps', '분': 'min' };
  return unitMap[STAT_CATS[k].unit] || STAT_CATS[k].unit;
}
var curSC = "weight";

function getSharedStatId() {
  var f = JSON.parse(localStorage.getItem('friends') || '[]');
  if (!myCode || !f.length) return null;
  return [myCode, f[0]].sort().join('_stat_');
}

var statListener = null;

function getSD() { try { return JSON.parse(localStorage.getItem("hStats")||"{}"); } catch(e) { return {}; } }
function setSD(d) {
  localStorage.setItem("hStats", JSON.stringify(d));
  // Firestore 동기화
  var sid = getSharedStatId();
  if (sid) {
    db.collection('stats').doc(sid).set({ data: d, updatedBy: myCode, ts: firebase.firestore.Timestamp.now() }).catch(function(e) {
      console.log('stat save error:', e.message);
    });
  }
}

function openStats() {
  document.getElementById("featureTitle").textContent = localStorage.getItem("lang")==="en" ? "Health Stats" : "건강 통계";
  // Firestore 리스너
  if (statListener) { statListener(); statListener = null; }
  var sid = getSharedStatId();
  if (sid) {
    var firstLoad = true;
    statListener = db.collection('stats').doc(sid).onSnapshot(function(snap) {
      if (snap.exists) {
        var d = snap.data();
        localStorage.setItem("hStats", JSON.stringify(d.data || {}));
        if (!firstLoad && d.updatedBy && d.updatedBy !== myCode) {
          if (localStorage.getItem('notifTodo') === 'true') sendNotification('통계', '건강 기록이 업데이트됐어요');
        }
        firstLoad = false;
        renderStatsUI();
      }
    });
  }
  renderStatsUI();
  showScreen("fakeFeature");
}

function renderStatsUI() {
  var fc = document.getElementById("featureContent");
  var data = getSD();
  var cat = STAT_CATS[curSC];
  var entries = (data[curSC]||[]).slice().sort(function(a,b){return a.date>b.date?1:-1;});

  var tabHtml = '<div style="display:flex;gap:6px;overflow-x:auto;padding:4px 0 12px;scrollbar-width:none;">';
  Object.keys(STAT_CATS).forEach(function(k) {
    var c = STAT_CATS[k];
    var active = (k === curSC);
    var hasDot = data[k] && data[k].length > 0;
    var bg = active ? "var(--primary)" : "#f1f5f9";
    var col = active ? "#fff" : "#64748b";
    var btn = document.createElement("button");
    btn.textContent = c.emoji + " " + c.label + (hasDot ? "●" : "");
    btn.setAttribute("data-scat", k);
    btn.style.cssText = "flex-shrink:0;padding:6px 12px;border-radius:20px;border:none;cursor:pointer;font-size:15px;font-weight:600;background:" + bg + ";color:" + col + ";";
    tabHtml += btn.outerHTML;
  });
  tabHtml += "</div>";

  var addHtml = '<div style="text-align:right;margin-bottom:12px;"><button id="openSmBtn" style="background:var(--primary);color:#fff;border:none;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;">' + (localStorage.getItem('lang')==='en' ? '+ Add' : '+ 입력') + '</button></div>';

  var chartHtml = '<div style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:16px;"><div style="font-size:14px;font-weight:700;color:#1e293b;">' + cat.emoji + " " + statLabel(curSC) + '</div><div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">' + (localStorage.getItem('lang')==='en' ? 'Unit: ' : '단위: ') + statUnit(curSC) + '</div>';
  if (entries.length === 0) {
    chartHtml += '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:30px 0;">데이터가 없어요.<br>+ 입력으로 추가해보세요!</div>';
  } else {
    chartHtml += '<canvas id="sCanvas" style="width:100%;"></canvas>';
  }
  chartHtml += "</div>";

  var listHtml = '<div style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:8px;">' + (localStorage.getItem('lang')==='en' ? 'Recent Records' : '최근 기록') + '</div>';
  entries.slice().reverse().slice(0,10).forEach(function(e, i) {
    var origIdx = entries.length - 1 - i;
    var row = '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fff;border-radius:12px;margin-bottom:6px;box-shadow:0 1px 4px rgba(0,0,0,.05);">'
      + '<span style="font-size:13px;color:#64748b;">' + e.date + '</span>'
      + '<span style="font-size:15px;font-weight:700;color:' + cat.color + ';">' + e.value + ' <small style="font-size:11px;color:#94a3b8;">' + cat.unit + '</small></span>'
      + '<button data-dcat="' + curSC + '" data-didx="' + origIdx + '" style="background:none;border:none;color:#cbd5e1;font-size:20px;cursor:pointer;">×</button>'
      + '</div>';
    listHtml += row;
  });

  fc.innerHTML = '<div style="padding:16px;">' + tabHtml + addHtml + chartHtml + listHtml + '</div>';

  // 이벤트 바인딩
  fc.querySelectorAll("[data-scat]").forEach(function(btn) {
    btn.addEventListener("click", function() { curSC = this.getAttribute("data-scat"); renderStatsUI(); });
  });
  fc.querySelectorAll("[data-dcat]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      delSE(this.getAttribute("data-dcat"), parseInt(this.getAttribute("data-didx")));
    });
  });
  var smBtn = document.getElementById("openSmBtn");
  if (smBtn) smBtn.addEventListener("click", openSM);

  if (entries.length > 0) {
    setTimeout(function() {
      var canvas = document.getElementById("sCanvas");
      if (canvas) drawSC(canvas, entries, cat);
    }, 50);
  }
}

function drawSC(canvas, entries, cat) {
  var dpr = window.devicePixelRatio || 1;
  var W = canvas.parentElement.clientWidth - 32;
  var H = 160;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  var ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  var vals = entries.map(function(e){return parseFloat(e.value);});
  var mn = Math.min.apply(null,vals), mx = Math.max.apply(null,vals), rng = mx-mn||1;
  var pL=40,pR=10,pT=12,pB=24,gW=W-pL-pR,gH=H-pT-pB;
  for(var g=0;g<=4;g++){
    var gy=pT+(gH/4)*g;
    ctx.strokeStyle="#f1f5f9";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pL,gy);ctx.lineTo(W-pR,gy);ctx.stroke();
    ctx.fillStyle="#94a3b8";ctx.font="9px sans-serif";ctx.textAlign="right";
    ctx.fillText((mx-(rng/4)*g).toFixed(1),pL-3,gy+3);
  }
  var pts=entries.map(function(e,i){return{
    x:pL+(entries.length>1?(gW/(entries.length-1))*i:gW/2),
    y:pT+gH-((parseFloat(e.value)-mn)/rng)*gH
  };});
  var gr=ctx.createLinearGradient(0,pT,0,pT+gH);
  gr.addColorStop(0,cat.color+"44");gr.addColorStop(1,cat.color+"00");
  ctx.beginPath();ctx.moveTo(pts[0].x,pT+gH);
  pts.forEach(function(p){ctx.lineTo(p.x,p.y);});
  ctx.lineTo(pts[pts.length-1].x,pT+gH);ctx.closePath();
  ctx.fillStyle=gr;ctx.fill();
  ctx.beginPath();ctx.strokeStyle=cat.color;ctx.lineWidth=2.5;ctx.lineJoin="round";
  pts.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});
  ctx.stroke();
  pts.forEach(function(p,i){
    ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
    ctx.fillStyle="#fff";ctx.fill();ctx.strokeStyle=cat.color;ctx.lineWidth=2;ctx.stroke();
    if(entries.length<=7||i%Math.ceil(entries.length/6)===0){
      ctx.fillStyle="#94a3b8";ctx.font="8px sans-serif";ctx.textAlign="center";
      ctx.fillText(entries[i].date.slice(5),p.x,H-2);
    }
  });
}

function openSM() {
  var overlay = document.createElement("div");
  overlay.id = "smOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;";
  var today = new Date().toISOString().slice(0,10);

  var selOpts = "";
  Object.keys(STAT_CATS).forEach(function(k){
    selOpts += '<option value="' + k + '"' + (k===curSC?" selected":"") + '>' + STAT_CATS[k].emoji + " " + statLabel(k) + " (" + statUnit(k) + ")</option>";
  });

  overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:24px;width:85%;max-width:320px;">'
    + '<div style="font-size:16px;font-weight:700;margin-bottom:16px;">수치 입력</div>'
    + '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">카테고리</div>'
    + '<select id="smCat" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:13px;margin-bottom:12px;box-sizing:border-box;">' + selOpts + '</select>'
    + '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">수치</div>'
    + '<input id="smVal" type="number" step="0.1" placeholder="수치 입력" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:16px;margin-bottom:12px;box-sizing:border-box;"/>'
    + '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">날짜</div>'
    + '<input id="smDate" type="date" value="' + today + '" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:14px;margin-bottom:16px;box-sizing:border-box;"/>'
    + '<button id="smSaveBtn" style="width:100%;padding:12px;background:var(--primary);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:8px;">저장</button>'
    + '<button id="smCancelBtn" style="width:100%;padding:10px;background:#f1f5f9;color:#64748b;border:none;border-radius:12px;font-size:14px;cursor:pointer;">취소</button>'
    + '</div>';

  document.body.appendChild(overlay);
  document.getElementById("smSaveBtn").addEventListener("click", saveSE);
  document.getElementById("smCancelBtn").addEventListener("click", function(){ overlay.remove(); });
}

function saveSE() {
  var cat = document.getElementById("smCat").value;
  var val = document.getElementById("smVal").value.trim();
  var date = document.getElementById("smDate").value;
  if(!val||!date){alert("수치와 날짜를 입력해주세요");return;}
  var data = getSD();
  if(!data[cat]) data[cat]=[];
  data[cat].push({value:parseFloat(val),date:date});
  setSD(data);
  curSC = cat;
  document.getElementById("smOverlay").remove();
  renderStatsUI();
}

function delSE(cat, idx) {
  var data = getSD();
  if(!data[cat]) return;
  data[cat].sort(function(a,b){return a.date>b.date?1:-1;});
  data[cat].splice(idx,1);
  setSD(data);
  renderStatsUI();
}

// ── 날씨 위젯 ──────────────────────────────────────────
const OWM_KEY = '4388aeee14859bf5e7351a18d1d35db0';

function startClock() {
  function tick() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2,'0');
    var m = String(now.getMinutes()).padStart(2,'0');
    var s = String(now.getSeconds()).padStart(2,'0');
    var days = ['일','월','화','수','목','금','토'];
    var lang2 = localStorage.getItem('lang') || 'ko';
    var dateStr;
    if (lang2 === 'en') {
      var mns = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var dns = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      dateStr = mns[now.getMonth()] + ' ' + now.getDate() + ' (' + dns[now.getDay()] + ')';
    } else {
      dateStr = (now.getMonth()+1) + '월 ' + now.getDate() + '일 (' + days[now.getDay()] + ')';
    }
    var el = document.getElementById('widgetClock');
    var del = document.getElementById('widgetDate');
    if (el) el.innerHTML = h + ':' + m + '<span style="font-size:18px;opacity:0.7;">:' + s + '</span>';
    if (del) del.textContent = dateStr;
  }
  tick();
  setInterval(tick, 1000);
}

function getWeatherIcon(id) {
  if (id >= 200 && id < 300) return '⛈️';
  if (id >= 300 && id < 400) return '🌦️';
  if (id >= 500 && id < 600) return '🌧️';
  if (id >= 600 && id < 700) return '❄️';
  if (id >= 700 && id < 800) return '🌫️';
  if (id === 800) return '☀️';
  if (id === 801) return '🌤️';
  if (id === 802) return '⛅';
  if (id >= 803) return '☁️';
  return '🌡️';
}

function getDustLevel(pm10) {
  if (pm10 <= 30) return { text: '좋음', color: '#4ade80' };
  if (pm10 <= 80) return { text: '보통', color: '#facc15' };
  if (pm10 <= 150) return { text: '나쁨', color: '#fb923c' };
  return { text: '매우나쁨', color: '#f87171' };
}

function getClothes(temp, pm10) {
  var dust = pm10 > 80 ? ' 마스크 착용 권장' : '';
  if (temp >= 28) return '민소매·반팔·반바지·원피스' + dust;
  if (temp >= 23) return '반팔·얇은 셔츠·반바지' + dust;
  if (temp >= 20) return '블라우스·긴팔·면바지·청바지' + dust;
  if (temp >= 17) return '얇은 가디건·긴바지' + dust;
  if (temp >= 12) return '자켓·가디건·청바지' + dust;
  if (temp >= 9) return '트렌치코트·니트·청바지' + dust;
  if (temp >= 5) return '울코트·히트텍·레이어드' + dust;
  return '패딩·두꺼운 코트·목도리' + dust;
}

async function loadWeather() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async function(pos) {
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    try {
      // 날씨
      var wLang = localStorage.getItem('lang')==='en' ? 'en' : 'kr';
      var wRes = await fetch('https://api.openweathermap.org/data/2.5/weather?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY+'&units=metric&lang='+wLang);
      var wData = await wRes.json();
      var temp = Math.round(wData.main.temp);
      var desc = wData.weather[0].description;
      var icon = getWeatherIcon(wData.weather[0].id);
      var city = wData.name;

      document.getElementById('widgetTemp').textContent = temp + '°';
      document.getElementById('widgetDesc').textContent = desc;
      document.getElementById('widgetWeatherIcon').textContent = icon;
      document.getElementById('widgetLocation').textContent = '📍 ' + city;

      // 오늘 최저/최고 - forecast API 사용
      var fRes = await fetch('https://api.openweathermap.org/data/2.5/forecast?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY+'&units=metric&cnt=8');
      var fData = await fRes.json();
      var todayTemps = fData.list.map(function(item){ return item.main.temp; });
      var tMin = Math.round(Math.min.apply(null, todayTemps));
      var tMax = Math.round(Math.max.apply(null, todayTemps));
      document.getElementById('widgetTempMin').textContent = tMin + '°';
      document.getElementById('widgetTempMax').textContent = tMax + '°';

      // 미세먼지
      var aRes = await fetch('https://api.openweathermap.org/data/2.5/air_pollution?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY);
      var aData = await aRes.json();
      var pm10 = Math.round(aData.list[0].components.pm10);
      var pm25 = Math.round(aData.list[0].components.pm2_5);
      var level = getDustLevel(pm10);

      var level25 = getDustLevel(pm25);
      document.getElementById('widgetDustVal').innerHTML = 
        (localStorage.getItem('lang')==='en' ? 'Fine dust ' : '미세 ') + '<b style="color:' + level.color + '">' + level.text + '</b><br>' +
        (localStorage.getItem('lang')==='en' ? 'Ultra-fine ' : '초미세 ') + '<b style="color:' + level25.color + '">' + level25.text + '</b>';
      document.getElementById('widgetDustLevel').textContent = '';

      // 옷차림
      document.getElementById('widgetClothesVal').textContent = getClothes(temp, pm10);

    } catch(e) {
      document.getElementById('widgetClothesVal').textContent = '날씨 정보 없음';
    }
  }, function() {
    document.getElementById('widgetClothesVal').textContent = '위치 권한 필요';
  });
}

// 초기 실행
startClock();
loadWeather();
// 30분마다 날씨 갱신
setInterval(loadWeather, 30 * 60 * 1000);

// 이미지 뷰어
let viewerUrls = [];
let viewerIdx = 0;
let swipeSX = 0, swipeSY = 0;

function openImgViewer(urls, idx) {
  viewerUrls = urls;
  viewerIdx = idx;
  const viewer = document.getElementById('imgViewer');
  viewer.style.display = 'flex';
  updateViewer();

  // 스와이프 이벤트
  const area = document.getElementById('imgViewerSwipe');
  area.ontouchstart = function(e) {
    swipeSX = e.touches[0].clientX;
    swipeSY = e.touches[0].clientY;
  };
  area.ontouchend = function(e) {
    const dx = e.changedTouches[0].clientX - swipeSX;
    const dy = e.changedTouches[0].clientY - swipeSY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      changeViewerImg(dx < 0 ? 1 : -1);
    }
  };
  // 배경 탭으로 닫기
  viewer.onclick = function(e) {
    if (e.target === viewer || e.target.id === 'imgViewerSwipe') closeImgViewer();
  };
}

function closeImgViewer() {
  document.getElementById('imgViewer').style.display = 'none';
}

function changeViewerImg(dir) {
  viewerIdx = (viewerIdx + dir + viewerUrls.length) % viewerUrls.length;
  updateViewer();
}

function updateViewer() {
  const url = viewerUrls[viewerIdx];
  document.getElementById('imgViewerImg').src = url;
  document.getElementById('imgViewerCounter').textContent = viewerUrls.length > 1 ? (viewerIdx+1) + ' / ' + viewerUrls.length : '';
  // 다운로드 버튼
  const dl = document.getElementById('imgViewerDownload');
  dl.href = url;
  dl.download = 'image_' + (viewerIdx+1) + '.jpg';
}

// ── i18n ──────────────────────────────────────────────
const I18N = {
  ko: {
    todo: '할 일', schedule: '일정표', alarm: '알림',
    memo: '메모', goal: '목표', stats: '통계',
    project: '프로젝트', tag: '태그', calendar: '달력',
    settings: '설정', back: '← 뒤로',
    settingsTitle: '설정', appNameLabel: '앱 이름',
    save: '저장', themeColor: '테마 색상',
    notifSection: '알림', notifApp: '앱 알림',
    notifCal: '일정 알림', notifTodo: '할 일 알림',
    language: '언어',
    todoTitle: '할 일', todoPlaceholder: '새 할 일 추가...',
    memoTitle: '메모', calendarTitle: '달력',
    statsTitle: '건강 통계', statInput: '수치 입력',
    recentRecord: '최근 기록',
    noData: '데이터가 없어요.\n+ 입력으로 추가해보세요!',
    chatList: '목록', noFriend: '친구를 추가하면 채팅이 시작됩니다',
    msgPlaceholder: '메시지 입력...',
    dust: '미세먼지', clothes: '👕 옷차림 추천',
    loading: '로딩 중...', locationNeeded: '위치 권한 필요',
    cancel: '취소', save2: '저장', delete: '삭제',
  },
  en: {
    todo: 'To-Do', schedule: 'Schedule', alarm: 'Alarm',
    memo: 'Memo', goal: 'Goals', stats: 'Stats',
    project: 'Projects', tag: 'Tags', calendar: 'Calendar',
    settings: 'Settings', back: '← Back',
    settingsTitle: 'Settings', appNameLabel: 'App Name',
    save: 'Save', themeColor: 'Theme Color',
    notifSection: 'Notifications', notifApp: 'App Alerts',
    notifCal: 'Schedule Alerts', notifTodo: 'To-Do Alerts',
    language: 'Language',
    todoTitle: 'To-Do', todoPlaceholder: 'Add new task...',
    memoTitle: 'Memo', calendarTitle: 'Calendar',
    statsTitle: 'Health Stats', statInput: 'Enter Data',
    recentRecord: 'Recent Records',
    noData: 'No data yet.\nTap + to add!',
    chatList: 'Chats', noFriend: 'Add a friend to start chatting',
    msgPlaceholder: 'Type a message...',
    dust: 'Air Quality', clothes: '👕 Outfit Tip',
    loading: 'Loading...', locationNeeded: 'Location permission needed',
    cancel: 'Cancel', save2: 'Save', delete: 'Delete',
  }
};

let currentLang = localStorage.getItem('lang') || 'ko';

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || (I18N['ko'][key]) || key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
  applyLang();
}

function applyLang() {
  currentLang = localStorage.getItem('lang') || 'ko';
  var en = currentLang === 'en';
  updateFakeDate();

  var sel = document.getElementById('langSelect');
  if (sel) sel.value = currentLang;

  // 메인 메뉴
  var menuLabels = document.querySelectorAll('#menuGrid .menu-label');
  var menuKeys = ['todo','schedule','alarm','memo','goal','stats','project','tag','calendar'];
  menuLabels.forEach(function(el,i){ if(menuKeys[i]) el.textContent = t(menuKeys[i]); });

  // 날짜 배너
  _setText('dateSubtitle', en ? "Check today's schedule" : '오늘의 일정을 확인하세요');

  // 서브타이틀
  _setText('settingsTitle', en ? 'Settings' : '설정');
  _setText('todoTitle', en ? 'To-Do' : '할 일');
  _setText('memoTitle', en ? 'Memo' : '메모');
  _setText('calendarTitle', en ? 'Calendar' : '달력');
  _setText('statsTitle', en ? 'Health Stats' : '건강 통계');
  _setText('chatListTitle', en ? 'Chats' : '목록');
  _setText('newMemoTitle', en ? 'New Memo' : '새 메모');
  _setText('featureTitle', document.getElementById('featureTitle') ? document.getElementById('featureTitle').textContent : '');

  // 뒤로가기
  document.querySelectorAll('[data-i18n-back]').forEach(function(el){ el.textContent = en ? '← Back' : '← 뒤로'; });
  _setText('memoListBack', en ? '← List' : '← 목록');

  // 설정 라벨
  _setText('appNameLabel', en ? 'App Name' : '앱 이름');
  _setText('themeColorLabel', en ? 'Theme Color' : '테마 색상');
  _setText('notifSectionLabel', en ? 'Notifications' : '알림');
  _setText('langLabel', en ? 'Language' : '언어');
  _setText('infoLabel', en ? 'Info' : '정보');
  _setText('notifAppLabel', en ? 'App Alerts' : '앱 알림');
  _setText('notifCalLabel', en ? 'Schedule Alerts' : '일정 알림');
  _setText('notifTodoLabel', en ? 'To-Do Alerts' : '할 일 알림');

  // 메모
  _setText('newMemoBtn', en ? '+ New Memo' : '+ 새 메모');
  _setText('memoSaveBtn', en ? 'Save' : '저장');
  var memoTP = document.getElementById('memoTitleInput');
  if(memoTP) memoTP.placeholder = en ? 'Title' : '제목';
  var memoCP = document.getElementById('memoContent');
  if(memoCP) memoCP.placeholder = en ? 'Enter memo...' : '메모를 입력하세요...';

  // 달력
  _setText('calRefreshBtn', en ? 'Refresh' : '새로고침');

  // 친구추가 모달
  _setText('addFriendTitle', en ? 'Add Friend' : '친구 추가');
  _setText('tabCode', en ? 'Code' : '코드');
  _setText('tabQRScan', en ? 'QR Scan' : 'QR 스캔');
  _setText('tabMyQR', en ? 'My QR' : '내 QR');
  _setText('addFriendBtn', en ? 'Add' : '추가');
  _setText('regenCodeBtn', en ? '🔄 Regenerate' : '🔄 코드 재생성');

  // 자동삭제
  _setText('autoDeleteTitle', en ? 'Auto-Delete Timer' : '자동삭제 시간');

  // 보안설정
  _setText('securityTitle', en ? 'Settings' : '설정');
  _setText('themeLabel2', en ? 'Theme' : '테마');
  _setText('fontSizeLabel', en ? 'Font Size' : '폰트 크기');
  _setText('lockPatternLabel', en ? 'Lock Pattern' : '잠금 패턴');
  _setText('patternChangeBtn', en ? 'Change Pattern' : '패턴 변경');
  _setText('enhancedSecLabel', en ? 'Enhanced Security' : '강화 보안');
  _setText('autoLockDesc', en ? 'Auto-lock chat when leaving screen' : '화면 이탈 시 채팅 자동 잠금');
  _setText('myCodeLabel', en ? 'My Code' : '내 코드');
  _setText('changeCodeTitle', en ? 'Change ID Code' : '식별 코드 변경');
  _setText('changeCodeConfirm', en ? 'Confirm' : '변경 확인');

  // 패턴
  _setText('patternSaveBtn', en ? 'Save Pattern' : '패턴 저장');

  // 통계
  _setText('statAddBtn', en ? '+ Add' : '+ 입력');
  _setText('statInputTitle', en ? 'Enter Data' : '수치 입력');
  _setText('statCatLabel', en ? 'Category' : '카테고리');
  _setText('statValLabel', en ? 'Value' : '수치');
  _setText('statDateLabel', en ? 'Date' : '날짜');

  // 날씨
  _setText('dustLabel', en ? 'Air Quality' : '미세먼지');
  _setText('clothesLabel', en ? '👕 Outfit' : '👕 옷차림 추천');

  // placeholder
  var todoEl = document.getElementById('todoInputEl') || document.getElementById('todoInput');
  if(todoEl) todoEl.placeholder = en ? 'Add new task...' : '새 할 일 추가...';
  var msgEl = document.getElementById('msgInput');
  if(msgEl) msgEl.placeholder = en ? 'Type a message...' : '메시지 입력...';

  // 이미지 다운로드
  _setText('imgDownloadBtn', en ? '⬇ Save' : '⬇ 저장');

  // 보안설정 내부 버튼
  var dBtn = document.getElementById('themeDarkBtn'); if(dBtn) dBtn.textContent = en ? 'Dark' : '다크';
  var lBtn = document.getElementById('themeLightBtn'); if(lBtn) lBtn.textContent = en ? 'Light' : '라이트';
  _setText('fontSmLabel', en ? 'S' : '소');
  _setText('fontMdLabel', en ? 'M' : '중');
  _setText('fontLgLabel', en ? 'L' : '대');
  _setText('changeCodeBtn', en ? 'Change ID Code' : '식별 코드 변경');
  _setText('closeSecretBtn', en ? 'Close' : '닫기');
  _setText('closeAddFriendBtn', en ? 'Close' : '닫기');
  _setText('closeTimerBtn', en ? 'Close' : '닫기');

  // 달력 통계
  _setText('calAchievedLabel', en ? 'Achieved' : '달성일');
  _setText('calRateLabel', en ? 'Rate' : '달성률');
  _setText('calStreakLabel', en ? 'Streak' : '연속 달성');

  // 알림 토글
  _setText('notifAppLabel', en ? 'App Alerts' : '앱 알림');
  _setText('notifCalLabel', en ? 'Schedule Alerts' : '일정 알림');
  _setText('notifTodoLabel', en ? 'To-Do Alerts' : '할 일 알림');

  // 닉네임 설정
  _setText('nicknameLabel', en ? 'Set your nickname' : '닉네임을 설정하세요');
  _setText('nicknameSetBtn', en ? 'Set' : '설정');
  _setText('exitChatBtn', en ? '← Exit' : '← 나가기');
  var nnInput = document.getElementById('nicknameInput');
  if (nnInput) nnInput.placeholder = en ? 'Enter nickname' : '닉네임 입력';

  // 할일 빈 목록 갱신
  var emptyState = document.querySelector('.empty-state');
  if (emptyState) emptyState.innerHTML = '📋<br/>' + (en ? 'No tasks yet' : '할 일이 없습니다');

  // 달력 갱신 (요일 헤더)
  var calScreen = document.getElementById('calendarScreen');
  if (calScreen && calScreen.classList.contains('active')) renderCalendar();

  // 친구추가 모달
  _setText('friendCodeDesc', en ? "Enter your friend's ID code" : '친구의 식별 코드를 입력하세요');
  var fci = document.getElementById('friendCodeInput2') || document.getElementById('friendCodeInput');
  if (fci) fci.placeholder = en ? 'Enter friend code' : '친구 코드 입력';
  _setText('qrScanDesc', en ? "Scan your friend's QR code" : '친구의 QR코드를 스캔하세요');
  _setText('myQrDesc', en ? 'Show your QR code to your friend' : '내 QR코드를 친구에게 보여주세요');

  // 닉네임 placeholder
  var nnInput2 = document.getElementById('myCodeInput');
  if (nnInput2) nnInput2.placeholder = en ? 'Enter nickname' : '닉네임 입력';
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// 앱 로드 시 적용
setTimeout(applyLang, 300);
