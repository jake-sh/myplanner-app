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

// ── 패턴 해시 (복원 키) ──────────────────────────────
// 패턴 배열 → SHA-256 16진 문자열
// 백업/패턴인덱스의 키로 사용
async function patternToHash(pattern) {
  if (!pattern || !pattern.length) return null;
  var text = JSON.stringify(pattern);
  try {
    var enc = new TextEncoder().encode(text);
    var buf = await crypto.subtle.digest('SHA-256', enc);
    var hex = Array.from(new Uint8Array(buf))
      .map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    return hex;
  } catch(e) {
    // crypto.subtle 미지원 환경 폴백 (이론적으로만, 모던 브라우저에서는 발생 안 함)
    return text;
  }
}

// 기본 패턴 여부 판정 (마스터 PIN인가)
function isMasterPattern(pattern) {
  if (!pattern || pattern.length !== DEFAULT_PATTERN.length) return false;
  for (var i = 0; i < pattern.length; i++) {
    if (pattern[i] !== DEFAULT_PATTERN[i]) return false;
  }
  return true;
}
let autoDeleteMinutes = parseInt(localStorage.getItem('autoDeleteMin') || '5');
let myCode = localStorage.getItem('myCode') || '';
let friends = JSON.parse(localStorage.getItem('friends') || '[]');
let activeFriendCode = null, chatRoomId = null;
let messageListener = null, friendsListener = null, roomListener = null, calListener = null, todoListener = null;
let deleteTimers = {}, countdownTimers = {}, qrScanner = null;
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let editingMemoIndex = null;

// ── localStorage.setItem 래퍼: 백업 대상 키 변경 시 자동 백업 스케줄 ──
// BACKUP_KEYS는 아래쪽에 정의되어 있어 런타임 참조 시점엔 존재함
(function() {
  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    var result = origSetItem.apply(this, arguments);
    try {
      // myCode가 있고, 백업 대상 키인 경우에만 스케줄
      if (this === window.localStorage && typeof myCode !== 'undefined' && myCode &&
          typeof BACKUP_KEYS !== 'undefined' && BACKUP_KEYS.indexOf(key) >= 0 &&
          typeof scheduleBackup === 'function') {
        scheduleBackup();
      }
    } catch(e) {}
    return result;
  };
})();

// ── INIT ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // ── 최초 실행 시 디폴트값 설정 ──
  if (!localStorage.getItem('_defaultsSet')) {
    localStorage.setItem('darkMode', 'true');
    localStorage.setItem('themeColor', '#334155');
    localStorage.setItem('iconStyle', 'svg');
    localStorage.setItem('svgColorMode', 'off');
    localStorage.setItem('lang', 'en');
    localStorage.setItem('notifApp', 'true');
    localStorage.setItem('notifEvent', 'true');
    localStorage.setItem('autoLock', 'true');
    localStorage.setItem('_defaultsSet', '1');
  }

  // 알림 키 마이그레이션 (notifCal/notifTodo/notifEnabled → notifApp/notifEvent)
  if (!localStorage.getItem('_notifMigrated')) {
    // notifApp이 없으면 기존 notifCal 또는 notifTodo 중 하나라도 true면 true
    if (localStorage.getItem('notifApp') === null) {
      var anyOn = localStorage.getItem('notifCal') === 'true' ||
                  localStorage.getItem('notifTodo') === 'true';
      localStorage.setItem('notifApp', anyOn ? 'true' : 'false');
    }
    // notifEvent가 없으면 기존 notifEnabled를 그대로 승계
    if (localStorage.getItem('notifEvent') === null) {
      localStorage.setItem('notifEvent',
        localStorage.getItem('notifEnabled') === 'true' ? 'true' : 'false');
    }
    // 폐기 키 제거
    localStorage.removeItem('notifCal');
    localStorage.removeItem('notifTodo');
    // notifEnabled는 채팅 알림 로직 호환성 때문에 notifEvent와 같이 둔다 (이후 코드에서 양쪽 모두 set)
    localStorage.setItem('_notifMigrated', '1');
  }
  // 기존 사용자도 다크모드 기본값 강제 적용 (한 번만)
  if (!localStorage.getItem('_darkDefault')) {
    localStorage.setItem('darkMode', 'true');
    localStorage.setItem('_darkDefault', '1');
  }

  // 백업 v2 마이그레이션: 옛 백업 위치(users/{myCode}/backup/data) 자동 정리
  // 첫 실행 시 한 번만 실행. 옛 데이터 삭제 + 새 구조로 자동 백업 트리거.
  if (!localStorage.getItem('_backupV2Migrated') && myCode) {
    // 앱 초기화가 충분히 끝난 뒤 (Firebase auth 완료 대기)
    setTimeout(async function() {
      if (!myCode || typeof db === 'undefined') return;
      // 옛 백업 문서 삭제
      db.collection('users').doc(myCode).collection('backup').doc('data')
        .delete().catch(function(){});
      // 새 구조로 즉시 백업 (backups/{myCode} + patternIndex 등록)
      try { await performBackup(); } catch(e) {}
      localStorage.setItem('_backupV2Migrated', '1');
    }, 3000);  // 앱 초기화가 충분히 끝난 뒤
  }

  // 1. 테마/다크/타이틀 즉시 적용
  var t = localStorage.getItem('themeColor');
  if (t) document.documentElement.style.setProperty('--primary', t);
  applyDarkMode();
  applyTitle();
  // 2. 날짜/시계
  updatePlanDate();
  startClock();
  // 3. 화면 표시
  showScreen('planApp');

  // 3-1. 공유 인텐트 처리 (다른 앱에서 텍스트 공유로 들어온 경우)
  // 메인 화면을 띄운 직후에 호출 → 백그라운드 동작처럼 보이며 즉시 닫힘 시도
  // 공유로 진입한 경우 아래의 비동기 초기화는 그대로 두고 창만 닫는다
  try { handleShareIntent(); } catch(e) {}

  // 4. 나머지 비동기
  setTimeout(function() {
    if (t) { applyMenuTheme(t); applyThemeBtnBorder(t); }
    else { applyThemeBtnBorder('#6C63FF'); }
    applyIconStyle();
    applyLang();
    loadWeather();
  }, 100);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // 새 SW가 activate되면 자동으로 페이지 새로고침 (한 번만)
    var _swReloaded = false;
    navigator.serviceWorker.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'SW_ACTIVATED' && !_swReloaded) {
        _swReloaded = true;
        // 마지막 본 버전과 다를 때만 새로고침 (무한 루프 방지)
        var lastVer = localStorage.getItem('_swVer');
        if (lastVer !== e.data.version) {
          localStorage.setItem('_swVer', e.data.version);
          // 잠시 대기 후 새로고침 (현재 진행 중인 작업 보호)
          setTimeout(function() { window.location.reload(); }, 500);
        }
      }
    });
  }

  // 채팅 입력창 자동 높이 조절 (1줄 기본, 2줄 최대, 이후 스크롤)
  var msgInput = document.getElementById('msgInput');
  if (msgInput) {
    msgInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 136) + 'px';
    });
  }
});

function updatePlanDate() {
  const d = new Date(), days = ['일','월','화','수','목','금','토'];
  var lang = localStorage.getItem('lang') || 'ko';
  if (lang === 'en') {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var daysEn = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    document.getElementById('planDate').textContent = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' (' + daysEn[d.getDay()] + ')';
  } else if (lang === 'zh') {
    var daysZh = ['日','一','二','三','四','五','六'];
    document.getElementById('planDate').textContent = d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日 (周' + daysZh[d.getDay()] + ')';
  } else if (lang === 'ja') {
    var daysJa = ['日','月','火','水','木','金','土'];
    document.getElementById('planDate').textContent = d.getFullYear() + '年' + (d.getMonth()+1) + '月' + d.getDate() + '日 (' + daysJa[d.getDay()] + ')';
  } else {
    document.getElementById('planDate').textContent = d.getFullYear() + '년 ' + (d.getMonth()+1) + '월 ' + d.getDate() + '일 (' + days[d.getDay()] + ')';
  }
}

// ── SCREEN ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id !== 'planApp') {
    history.pushState({ screen: id }, '', '');
  }
}

window.addEventListener('popstate', function(e) {
  // 이미지 뷰어가 열려있으면 닫기
  var viewer = document.getElementById('imgViewer');
  if (viewer && viewer.style.display === 'flex') {
    closeImgViewer();
    return;
  }
  // 뒤로가기 누르면 메인 화면으로
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('planApp').classList.add('active');
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
    return;
  }

  // [캐시 + myCode 있음] = 평소 흐름. 저장된 패턴과 일치하면 즉시 진입, 아니면 조용히 무시
  if (myCode) {
    if (arraysEqual(patternCopy, savedPattern)) {
      enterChatApp();
    }
    return;
  }

  // [myCode 없음] = 캐시 손실 또는 첫 사용자. 자동 복원 분기 호출
  tryAutoRestore(patternCopy).then(function(r) {
    if (!r) return;
    if (r.action === 'enter') {
      if (r.restored) {
        // 자동 복원 성공 → 새로고침으로 깔끔하게 시작
        window.location.reload();
      } else {
        // 마스터 패턴 신규 진입 → chatSetup이 알아서 코드 입력 화면 표시
        enterChatApp();
      }
    } else if (r.action === 'askCode') {
      // 후보 N명 → 마이코드 입력 모달
      showCodeInputModal(r.source, r.candidates);
    }
    // 'silent' → 아무 동작 안 함 (비인가 사용자 차단)
  }).catch(function(e) {
    console.log('[PATTERN] auto restore error:', e && e.message);
  });
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
  _setPatternBtn(false);
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
    const isEn = localStorage.getItem('lang') === 'en';
    document.getElementById('setupStatus').textContent = __T('Connect at least 4','최소 4개 이상 연결하세요','请至少连接4个','4個以上つなげてください');
    setTimeout(() => { clearSetupDots(); setupPattern = []; document.getElementById('setupStatus').textContent = ''; }, 1000);
  } else {
    var _lang = localStorage.getItem('lang') || 'ko';
    var _n = setupPattern.length;
    var _msg;
    if (_lang === 'en') _msg = 'Pattern set (' + _n + ')';
    else if (_lang === 'zh') _msg = '已设置图案 (' + _n + '个)';
    else if (_lang === 'ja') _msg = 'パターン入力済 (' + _n + '個)';
    else _msg = '패턴 입력됨 (' + _n + '개)';
    document.getElementById('setupStatus').textContent = _msg;
    _setPatternBtn(true);
  }
}

function checkSetupDot(x, y) {
  document.querySelectorAll('#setupGrid .pattern-dot').forEach(item => {
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (Math.hypot(x - cx, y - cy) <= r.width / 2) {
      const d = parseInt(item.dataset.dot);
      if (!setupPattern.includes(d)) { setupPattern.push(d); highlightSetupDot(d, true); }
    }
  });
}

function highlightSetupDot(dot, on) {
  const el = document.querySelector(`#setupGrid [data-dot="${dot}"]`);
  if (el) el.classList.toggle('lit', on);
}

function clearSetupDots() {
  document.querySelectorAll('#setupGrid .pattern-dot').forEach(el => el.classList.remove('lit'));
}

async function savePattern() {
  const isEn = localStorage.getItem('lang') === 'en';
  // 입력 전(Cancel 상태)이면 뒤로가기
  if (setupPattern.length < 4) { cancelPatternSetup(); return; }
  var oldPattern = savedPattern;
  savedPattern = [...setupPattern];
  localStorage.setItem('secPattern', JSON.stringify(savedPattern));

  // patternIndex 갱신: 옛 hash에서 내 myCode 제거, 새 hash에 추가
  // myCode가 있고 마스터 패턴(0125478)에서 벗어났을 때만 의미가 있음
  if (myCode) {
    try {
      var oldHash = await patternToHash(oldPattern);
      var newHash = await patternToHash(savedPattern);
      if (oldHash && oldHash !== newHash) {
        // 옛 인덱스에서 제거
        await db.collection('patternIndex').doc(oldHash).set({
          codes: firebase.firestore.FieldValue.arrayRemove(myCode)
        }, { merge: true }).catch(function(){});
      }
      // 새 hash로 즉시 백업 (인덱스 등록 포함)
      await performBackup();
    } catch(e) { console.log('[PATTERN] save error:', e.message); }
  }

  showAlert(__T('Pattern saved!','패턴이 저장되었습니다!','图案已保存!','パターンが保存されました!'));
  showScreen('chatApp');
}

function openPatternSetup() {
  setupPattern = []; isSetupDragging = false; clearSetupDots();
  document.getElementById('setupStatus').textContent = '';
  _setPatternBtn(false);
  showScreen('patternSetup');
}

function _setPatternBtn(confirmed) {
  const btn = document.getElementById('savePatternBtn');
  const isEn = localStorage.getItem('lang') === 'en';
  if (!btn) return;
  btn.style.display = 'block';
  btn.style.width = '100%';
  btn.style.padding = '14px';
  btn.style.border = 'none';
  btn.style.borderRadius = '12px';
  btn.style.fontSize = '15px';
  btn.style.cursor = 'pointer';
  btn.style.fontFamily = 'inherit';
  btn.style.fontWeight = confirmed ? '700' : '600';
  btn.style.background = confirmed ? 'var(--primary,#6C63FF)' : 'rgba(255,255,255,0.08)';
  btn.style.color = confirmed ? '#fff' : 'var(--text,#f1f5f9)';
  btn.textContent = confirmed ? (__T('Confirm','확인','确认','確認')) : (__T('Cancel','취소','取消','キャンセル'));
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
  else if (i === 7) openTag();
  else if (i === 8) openCalendar();
  else openPlanFeature(i);
}

const planData = [
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
const planDataEn = [
  null,
  ['10:00 Team meeting','13:00 Lunch appointment','15:30 Submit report','18:00 Off work'],
  ['⏰ 7:30 AM Wake up','⏰ 12:00 PM Lunch','⏰ 6:00 PM Off work'],
  null,
  ['🎯 Exercise 20x (12/20)','🎯 Read 2 books (1/2)','🎯 Savings goal achieved'],
  ['✅ Done tasks: 18','📅 Schedule rate: 85%','🔥 Streak: 7 days'],
  ['📁 Website renewal','📁 Marketing campaign','📁 Data analysis'],
  ['🏷️ Work (24)','🏷️ Personal (12)','🏷️ Important (8)'],
  null
];
const planDataZh = [
  null,
  ['10:00 团队会议','13:00 午餐约会','15:30 提交报告','18:00 下班'],
  ['⏰ 上午7:30 起床','⏰ 下午12:00 午餐','⏰ 下午6:00 下班'],
  null,
  ['🎯 运动20次 (12/20)','🎯 阅读2本 (1/2)','🎯 储蓄目标达成'],
  ['✅ 完成任务: 18个','📅 日程完成率: 85%','🔥 连续达成: 7天'],
  ['📁 网站改版','📁 营销活动','📁 数据分析'],
  ['🏷️ 工作 (24)','🏷️ 个人 (12)','🏷️ 重要 (8)'],
  null
];
const planDataJa = [
  null,
  ['10:00 チーム会議','13:00 ランチ約束','15:30 レポート提出','18:00 退勤'],
  ['⏰ 午前7:30 起床','⏰ 午後12:00 ランチ','⏰ 午後6:00 退勤'],
  null,
  ['🎯 運動20回 (12/20)','🎯 読書2冊 (1/2)','🎯 貯蓄目標達成'],
  ['✅ 完了タスク: 18件','📅 予定消化率: 85%','🔥 連続達成: 7日'],
  ['📁 ウェブサイトリニューアル','📁 マーケティングキャンペーン','📁 データ分析'],
  ['🏷️ 仕事 (24)','🏷️ 個人 (12)','🏷️ 重要 (8)'],
  null
];
const planTitles = ['할 일','일정표','알림','메모','목표','통계','프로젝트','태그','달력'];
const planTitlesEn = ['To-Do','Schedule','Alarm','Memo','Goals','Stats','Projects','Tags','Calendar'];
const planTitlesZh = ['待办','日程','闹钟','备忘','目标','统计','项目','标签','日历'];
const planTitlesJa = ['タスク','予定','アラーム','メモ','目標','統計','プロジェクト','タグ','カレンダー'];

function openPlanFeature(i) {
  var _lang = localStorage.getItem('lang') || 'ko';
  var _ft, _fd;
  if (_lang === 'en') { _ft = planTitlesEn[i]; _fd = planDataEn[i]; }
  else if (_lang === 'zh') { _ft = planTitlesZh[i]; _fd = planDataZh[i]; }
  else if (_lang === 'ja') { _ft = planTitlesJa[i]; _fd = planDataJa[i]; }
  else { _ft = planTitles[i]; _fd = planData[i]; }
  document.getElementById('featureTitle').textContent = _ft;
  document.getElementById('featureContent').innerHTML =
    `<div class="feature-placeholder"><h3>${_ft}</h3>` +
    (_fd||[]).map(t=>`<div class="plan-item"><div class="plan-check"></div>${t}</div>`).join('') + '</div>';
  showScreen('planFeature');
}



// ── 프라이버시 화면 (Enhanced Security 연동) ──────────────
function isAutoLockOn() { return localStorage.getItem('autoLock') !== 'false'; }

document.addEventListener('visibilitychange', function() {
  var el = document.getElementById('privacyScreen');
  if (!el) return;
  if (document.hidden) {
    if (isAutoLockOn()) el.style.display = 'block';
  } else {
    if (isAutoLockOn()) {
      showScreen('planApp');
      setTimeout(function() { el.style.display = 'none'; }, 600);
    } else {
      el.style.display = 'none';
    }
  }
});
// iOS standalone 대응
window.addEventListener('pagehide', function() {
  var el = document.getElementById('privacyScreen');
  if (el && isAutoLockOn()) el.style.display = 'block';
});
window.addEventListener('pageshow', function(e) {
  var el = document.getElementById('privacyScreen');
  if (el) el.style.display = 'none';
  if (e.persisted && isAutoLockOn()) {
    showScreen('planApp');
  }
});
var _appWasHidden = false;
var _filePickerOpen = false;

// 파일 선택창 열릴 때 플래그
document.addEventListener('click', function(e) {
  if (e.target && (e.target.id === 'fileInput' || e.target.id === 'memoImgInput')) _filePickerOpen = true;
});

var _blurTime = 0;
window.addEventListener('blur', function() {
  var el = document.getElementById('privacyScreen');
  if (el && isAutoLockOn()) el.style.display = 'block';
  _blurTime = Date.now();
  if (!_filePickerOpen) _appWasHidden = true;
});
window.addEventListener('focus', function() {
  var el = document.getElementById('privacyScreen');
  if (el) setTimeout(function(){ el.style.display = 'none'; }, 200);
  var elapsed = Date.now() - _blurTime;
  if (_filePickerOpen) {
    _filePickerOpen = false;
    return;
  }
  if (elapsed < 800) {
    _appWasHidden = false;
    return;
  }
  if (_appWasHidden) {
    _appWasHidden = false;
    if (isAutoLockOn()) showScreen('planApp');
  }
});

// ── TAG ──────────────────────────────────────────────
function _locForLang(lang) {
  if (lang === 'en') return 'en-US';
  if (lang === 'zh') return 'zh-CN';
  if (lang === 'ja') return 'ja-JP';
  return 'ko-KR';
}
function addTagNow() {
  var now = new Date();
  var tags = getTagList();
  var lang = localStorage.getItem('lang') || 'ko';
  var isEn = (lang === 'en');
  var loc = _locForLang(lang);
  var entry = {
    id: Date.now(),
    date: isEn
      ? now.toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric',weekday:'short'})
      : now.toLocaleDateString(loc, {year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}),
    time: now.toLocaleTimeString(loc, {hour:'2-digit',minute:'2-digit',second:'2-digit'}),
    ts: now.getTime()
  };
  tags.unshift(entry);
  saveTags(tags);
  // 저장 피드백
  var el = document.getElementById('widgetClock');
  if (el) {
    el.style.opacity = '0.4';
    setTimeout(function(){ el.style.opacity = '1'; }, 200);
  }
}

function getTagList() {
  try { return JSON.parse(localStorage.getItem('tagList') || '[]'); } catch(e){ return []; }
}

function saveTags(tags) {
  localStorage.setItem('tagList', JSON.stringify(tags));
}

function setTagAutoDelete(val) {
  localStorage.setItem('tagAutoDelete', val);
}

function autoDeleteTags(tags) {
  var days = parseInt(localStorage.getItem('tagAutoDelete') || '0');
  if (!days) return tags;
  var cutoff = Date.now() - days * 86400000;
  return tags.filter(function(t){ return t.ts > cutoff; });
}

function openTag() {
  var tags = autoDeleteTags(getTagList());
  saveTags(tags);
  renderTagList(tags);
  var autoVal = localStorage.getItem('tagAutoDelete') || '0';
  var sel = document.getElementById('tagAutoDelete');
  if (sel) sel.value = autoVal;
  showScreen('tagScreen');
  // 화면 표시 후 영문화 강제 적용
  var en = localStorage.getItem('lang') === 'en';
  setTimeout(function() {
    // tagBackBtn은 SVG 고정 - textContent 변경 안 함
    var t = document.getElementById('tagTitle');
    if (t) t.textContent = __T('Tags','태그','标签','タグ');
    var d = document.getElementById('tagDeleteAllBtn');
    if (d) d.textContent = __T('Clear All','전체삭제','全部清除','全て削除');
    var a = document.getElementById('tagAutoDeleteLabel');
    if (a) a.textContent = __T('Auto Delete','자동삭제','自动删除','自動削除');
  }, 50);
}

function renderTagList(tags) {
  var list = document.getElementById('tagList');
  if (!list) return;
  var isEn = localStorage.getItem('lang') === 'en';
  if (!tags.length) {
    list.innerHTML = '<div class="empty-state">' + (__T('No tags yet. Tap the clock to add.','시계를 탭해서 시간을 기록하세요.','点击时钟记录时间。','時計をタップして時間を記録してください。')) + '</div>';
    return;
  }
  list.innerHTML = tags.map(function(t, idx) {
    return '<div style="display:flex;align-items:center;background:var(--card,#fff);border-radius:14px;padding:12px 16px;box-shadow:0 1px 6px rgba(0,0,0,0.06);">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;">' +
        '<span style="font-size:11px;font-weight:700;color:#fff;">' + (tags.length - idx) + '</span>' +
      '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:15px;font-weight:700;color:var(--text,#1A1A2E);letter-spacing:0.5px;">' + t.time + '</div>' +
        '<div style="font-size:11px;color:#8B8FA8;margin-top:2px;">' + t.date + '</div>' +
      '</div>' +
      '<button onclick="deleteTag(' + t.id + ')" style="background:none;border:none;color:#ccc;font-size:20px;cursor:pointer;padding:4px 8px;line-height:1;">×</button>' +
    '</div>';
  }).join('');
}

function deleteTag(id) {
  var tags = getTagList().filter(function(t){ return t.id !== id; });
  saveTags(tags);
  renderTagList(tags);
}

function deleteAllTags() {
  var isEn = localStorage.getItem('lang') === 'en';
  var msg = __T('Delete all tags?','모든 태그를 삭제할까요?','删除所有标签?','全てのタグを削除しますか?');
  showConfirm(msg, function() { _doDeleteAllTags(); }); return;
}
function _doDeleteAllTags() {
  saveTags([]);
  renderTagList([]);
}

// ── SETTINGS ───────────────────────────────────────
function openSettings() {
  var notifEventEl = document.getElementById('notifEvent');
  var notifAppEl = document.getElementById('notifApp');
  if (notifEventEl) notifEventEl.checked = localStorage.getItem('notifEvent') === 'true';
  if (notifAppEl) notifAppEl.checked = localStorage.getItem('notifApp') === 'true';
  showScreen('settingsScreen');
  var t2 = localStorage.getItem('themeColor') || '#6C63FF';
  setTimeout(function(){ renderThemeRecentColors(); updateIconStyleBtns(); updateSvgColorBtns(); }, 200);
}


// ── 아이콘 스타일 ──────────────────────────────────────
var SVG_ICONS = {
  0: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/></svg>',
  2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  4: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>',
  5: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>',
  6: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><path d="M2 7a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z"/></svg>',
  7: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7" stroke-width="2.5"/></svg>',
  8: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><rect width="24" height="24" fill="transparent" stroke="none"/><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="17" y2="15"/><line x1="7" y1="18" x2="13" y2="18"/></svg>',
};
var EMOJI_ICONS = ['📋','📅','⏰','📝','🎯','📊','🗂️','🏷️','📆'];
var SVG_COLORS = (function() {
  try {
    var saved = JSON.parse(localStorage.getItem('svgColorsCustom') || 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch(e) {}
  return ['#10B981','#3B82F6','#F43F5E','#F59E0B','#F97316','#22C55E','#8B5CF6','#A855F7','#38BDF8'];
})();

function applyClothesIcon(en) {
  var isEn = (en !== undefined) ? en : (localStorage.getItem('lang') === 'en');
  var style = localStorage.getItem('iconStyle') || 'svg';
  var label = document.getElementById('clothesLabel');
  if (!label) return;
  var text = __T('Outfit','옷차림 추천','穿搭推荐','服装提案');
  if (style === 'emoji') {
    label.innerHTML = '👕 ' + text;
  } else {
    label.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13" style="vertical-align:middle;margin-right:3px;color:var(--primary);"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>' + text;
  }
}

function setIconStyle(style) {
  localStorage.setItem('iconStyle', style);
  applyIconStyle();
  applyClothesIcon();
  updateIconStyleBtns();
}

function setSvgColor(mode) {
  localStorage.setItem('svgColorMode', mode);
  if (mode === 'on') {
    randomizeSvgColors(true);
  }
  applyIconStyle();
  updateSvgColorBtns();
}

// HEX → HSL
function _hexToHsl(hex) {
  var r = parseInt(hex.slice(1,3),16)/255;
  var g = parseInt(hex.slice(3,5),16)/255;
  var b = parseInt(hex.slice(5,7),16)/255;
  var max = Math.max(r,g,b), min = Math.min(r,g,b);
  var h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    var d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

// HSL → HEX
function _hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s));
  l = Math.max(10, Math.min(90, l));
  var s1 = s/100, l1 = l/100;
  var c = (1 - Math.abs(2*l1-1)) * s1;
  var x = c * (1 - Math.abs((h/60)%2-1));
  var m = l1 - c/2;
  var r,g,b;
  if      (h<60)  { r=c;g=x;b=0; }
  else if (h<120) { r=x;g=c;b=0; }
  else if (h<180) { r=0;g=c;b=x; }
  else if (h<240) { r=0;g=x;b=c; }
  else if (h<300) { r=x;g=0;b=c; }
  else            { r=c;g=0;b=x; }
  var toHex = function(v) { return Math.round((v+m)*255).toString(16).padStart(2,'0'); };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// 유사 명도/채도 랜덤 색상 생성
function _randomSimilarColor(baseHex) {
  var hsl = _hexToHsl(baseHex);
  var h = hsl[0], s = hsl[1], l = hsl[2];
  var rnd = function(range) { return (Math.random()-0.5)*2*range; };
  // H: ±30° (색상 계열 약간 변화)
  // S: ±20% (채도 유사)
  // L: ±12% (명도 유사)
  return _hslToHex(h + rnd(25), s + rnd(20), l + rnd(8));
}

function randomizeSvgColors(silent) {
  var theme = localStorage.getItem('themeColor') || '#6C63FF';
  var count = SVG_COLORS.length;
  var newColors = [];
  for (var i = 0; i < count; i++) {
    newColors.push(_randomSimilarColor(theme));
  }
  SVG_COLORS = newColors;
  localStorage.setItem('svgColorsCustom', JSON.stringify(newColors));
  if (!silent) applyIconStyle();
}

function updateIconStyleBtns() {
  var style = localStorage.getItem('iconStyle') || 'svg';
  document.getElementById('iconStyleEmoji')?.classList.toggle('active', style === 'emoji');
  document.getElementById('iconStyleSvg')?.classList.toggle('active', style === 'svg');
  var svgOpt = document.getElementById('svgColorOption');
  if (svgOpt) svgOpt.style.display = style === 'svg' ? 'block' : 'none';
}

function updateSvgColorBtns() {
  var mode = localStorage.getItem('svgColorMode') || 'on';
  document.getElementById('svgColorOn')?.classList.toggle('active', mode === 'on');
  document.getElementById('svgColorOff')?.classList.toggle('active', mode === 'off');
}

function applyIconStyle() {
  var style = localStorage.getItem('iconStyle') || 'svg';
  var colorMode = localStorage.getItem('svgColorMode') || 'on';
  var isDark = localStorage.getItem('darkMode') === 'true';
  var themeColor = localStorage.getItem('themeColor') || '#334155';
  var isGray = themeColor === '#334155';

  // 테마색 미적용시 적용할 색상
  var themeIconColor = (isDark && isGray) ? '#9ca3af' : themeColor;

  document.querySelectorAll('#menuGrid .menu-item').forEach(function(item, i) {
    var iconEl = item.querySelector('.menu-icon');
    if (!iconEl) return;
    if (style === 'emoji') {
      var existSvg = iconEl.querySelector('svg');
      if (existSvg || !iconEl.textContent.trim()) {
        iconEl.innerHTML = EMOJI_ICONS[i] || '';
      }
      iconEl.style.fontSize = '30px';
      iconEl.style.color = '';
    } else {
      iconEl.style.fontSize = '';
      var svgEl = iconEl.querySelector('svg');
      // SVG 없을 때만 innerHTML 설정
      if (!svgEl) {
        iconEl.innerHTML = SVG_ICONS[i] || '';
        svgEl = iconEl.querySelector('svg');
      }
      if (svgEl) {
        if (isGray) {
          // 그레이 테마: SVG 라인 모두 화이트로 통일
          svgEl.style.color = '#94a3b8';
        } else {
          svgEl.style.color = colorMode === 'on' ? (SVG_COLORS[i] || '#6C63FF') : themeIconColor;
        }
      }
    }
  });
}


// ── 앱 타이틀 ──────────────────────────────────────────
// Tailwind 기반 웹 컬러 팔레트
var TITLE_COLORS = [
  '#fca5a5','#f87171','#ef4444','#dc2626','#b91c1c',
  '#fdba74','#fb923c','#f97316','#ea580c','#c2410c',
  '#fde047','#facc15','#eab308','#ca8a04','#a16207',
  '#86efac','#4ade80','#22c55e','#16a34a','#15803d',
  '#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e',
  '#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8',
  '#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca',
  '#d8b4fe','#c084fc','#a855f7','#9333ea','#7e22ce',
  '#f9a8d4','#f472b6','#ec4899','#db2777','#be185d',
  '#f1f5f9','#cbd5e1','#94a3b8','#64748b','#334155',
];

var _paletteTarget = null; // 'my' or 'planner'
var _longPressTimer = null;

function initTitleColorPalette() {
  var grid = document.getElementById('paletteGrid');
  if (!grid || grid.children.length > 0) return;
  TITLE_COLORS.forEach(function(hex) {
    var sw = document.createElement('div');
    sw.style.cssText = 'width:100%;aspect-ratio:1;border-radius:5px;cursor:pointer;border:1.5px solid rgba(128,128,128,0.15);background:' + hex;
    sw.onclick = function() { applyTitleColor(hex); };
    grid.appendChild(sw);
  });
}

function applyTitleFontSize(size) {
  if (!_paletteTarget) return;
  var key = _paletteTarget === 'my' ? 'titleMySize' : 'titlePlannerSize';
  localStorage.setItem(key, String(size));
  [32, 28, 24].forEach(function(s) {
    var btn = document.getElementById('fontSizeBtn' + s);
    if (btn) {
      btn.style.background = (s === size) ? 'var(--primary)' : 'var(--chat-surface2)';
      btn.style.color = (s === size) ? '#fff' : 'var(--chat-text)';
      btn.style.borderColor = (s === size) ? 'var(--primary)' : 'var(--chat-border)';
    }
  });
  updateTitlePreview();
}

function _updateFontSizeBtns(target) {
  var key = target === 'my' ? 'titleMySize' : 'titlePlannerSize';
  var cur = parseInt(localStorage.getItem(key) || (target === 'my' ? '27' : '18'));
  [32, 28, 24].forEach(function(s) {
    var btn = document.getElementById('fontSizeBtn' + s);
    if (btn) {
      var active = (s === cur);
      btn.style.background = active ? 'var(--primary)' : 'var(--chat-surface2)';
      btn.style.color = active ? '#fff' : 'var(--chat-text)';
      btn.style.borderColor = active ? 'var(--primary)' : 'var(--chat-border)';
    }
  });
}

function openTitleColorPalette(target, el) {
  _paletteTarget = target;
  initTitleColorPalette();
  var palette = document.getElementById('titleColorPalette');
  var label = document.getElementById('paletteLabel');
  var lang = localStorage.getItem('lang') || 'ko';
  var labelText;
  if (target === 'my') {
    if (lang === 'en') labelText = '1st: color & size';
    else if (lang === 'zh') labelText = '第一个: 颜色和大小';
    else if (lang === 'ja') labelText = '1番目: 色とサイズ';
    else labelText = '첫 번째: 색상·크기';
  } else {
    if (lang === 'en') labelText = '2nd: color & size';
    else if (lang === 'zh') labelText = '第二个: 颜色和大小';
    else if (lang === 'ja') labelText = '2番目: 色とサイズ';
    else labelText = '두 번째: 색상·크기';
  }
  if (label) label.textContent = labelText;
  _updateFontSizeBtns(target);
  var rect = el.getBoundingClientRect();
  var top = rect.bottom + 8;
  if (top + 320 > window.innerHeight) top = Math.max(8, rect.top - 328);
  palette.style.top = top + 'px';
  palette.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 276)) + 'px';
  palette.style.display = 'block';
}

// 프리뷰 span 롱프레스 바인딩 (입력창은 제거)
function _bindPreviewLongPress(spanEl, target) {
  if (spanEl._colorBound) return;
  spanEl._colorBound = true;
  var timer = null;
  spanEl.addEventListener('touchstart', function() {
    timer = setTimeout(function() { timer = null; openTitleColorPalette(target, spanEl); }, 500);
  }, { passive: true });
  spanEl.addEventListener('touchend', function() { if (timer) { clearTimeout(timer); timer = null; } });
  spanEl.addEventListener('touchmove', function() { if (timer) { clearTimeout(timer); timer = null; } });
  spanEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    timer = setTimeout(function() { timer = null; openTitleColorPalette(target, spanEl); }, 600);
  });
  spanEl.addEventListener('mouseup', function() { if (timer) { clearTimeout(timer); timer = null; } });
  spanEl.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}

function closeTitleColorPalette() {
  var palette = document.getElementById('titleColorPalette');
  if (palette) palette.style.display = 'none';
  _paletteTarget = null;
}

function applyTitleColor(hex) {
  if (!_paletteTarget) return;
  localStorage.setItem(_paletteTarget === 'my' ? 'titleMyColor' : 'titlePlannerColor', hex);
  closeTitleColorPalette();
  updateTitlePreview();
}

function updateTitlePreview() {
  var myInput = document.getElementById('titleMyInput');
  var plannerInput = document.getElementById('titlePlannerInput');
  var previewMy = document.getElementById('titlePreviewMy');
  var previewPlanner = document.getElementById('titlePreviewPlanner');
  var myColor = localStorage.getItem('titleMyColor') || 'var(--primary)';
  var plannerColor = localStorage.getItem('titlePlannerColor') || 'var(--chat-text)';
  var mySize = parseInt(localStorage.getItem('titleMySize') || '32');
  var plannerSize = parseInt(localStorage.getItem('titlePlannerSize') || '24');

  function resolveVal(inputEl, storageKey, defaultVal) {
    if (inputEl) return inputEl.value;
    var saved = localStorage.getItem(storageKey);
    return saved !== null ? saved : defaultVal;
  }
  var myVal = resolveVal(myInput, 'titleMy', 'my');
  var plannerVal = resolveVal(plannerInput, 'titlePlanner', 'planner');

  if (previewMy) {
    previewMy.textContent = myVal;
    previewMy.style.color = myColor;
    previewMy.style.fontSize = mySize + 'px';
  }
  if (previewPlanner) {
    previewPlanner.textContent = plannerVal;
    previewPlanner.style.color = plannerColor;
    previewPlanner.style.fontSize = plannerSize + 'px';
  }
}

function previewTitle() {
  var myVal = document.getElementById('titleMyInput').value;
  var plannerVal = document.getElementById('titlePlannerInput').value;
  var myEl = document.getElementById('titleMy');
  var plannerEl = document.getElementById('titlePlanner');
  if (myEl && myVal) myEl.textContent = myVal;
  if (plannerEl && plannerVal) plannerEl.textContent = plannerVal;
  updateTitlePreview();
}

function applyTitleChange() {
  var myVal = document.getElementById('titleMyInput').value;
  var plannerVal = document.getElementById('titlePlannerInput').value;
  if (myVal === '' && plannerVal === '') {
    localStorage.removeItem('titleMy');
    localStorage.removeItem('titlePlanner');
  } else {
    localStorage.setItem('titleMy', myVal);
    localStorage.setItem('titlePlanner', plannerVal);
  }
  applyTitle();
}

function applyTitle() {
  var myEl = document.getElementById('titleMy');
  var plannerEl = document.getElementById('titlePlanner');
  var myVal = localStorage.getItem('titleMy');
  var plannerVal = localStorage.getItem('titlePlanner');
  if (myVal === null) myVal = 'my';
  if (plannerVal === null) plannerVal = 'planner';

  // 프리뷰 크기(32/28/24) + 4 = 실제 크기(36/32/28)
  // 기본값: 첫째=대(32+4=36), 둘째=소(24+4=28)
  var mySizePrev    = parseInt(localStorage.getItem('titleMySize')      || '32');
  var plannerSizePrev = parseInt(localStorage.getItem('titlePlannerSize') || '24');
  var myActual      = mySizePrev + 4;
  var plannerActual = plannerSizePrev + 4;

  if (myEl) {
    myEl.textContent = myVal;
    myEl.setAttribute('style', 'font-size:' + myActual + 'px;');
    var myColor = localStorage.getItem('titleMyColor');
    if (myColor) myEl.style.color = myColor;
  }
  if (plannerEl) {
    plannerEl.textContent = plannerVal;
    plannerEl.setAttribute('style', 'font-size:' + plannerActual + 'px;');
    var plannerColor = localStorage.getItem('titlePlannerColor');
    if (plannerColor) plannerEl.style.color = plannerColor;
  }
}

function initTitleInputs() {
  // null = 한 번도 설정 안 함 → 기본값 사용
  // '' = 사용자가 의도적으로 공란 설정 → 공란 유지
  var myVal = localStorage.getItem('titleMy');
  var plannerVal = localStorage.getItem('titlePlanner');
  if (myVal === null) myVal = 'my';
  if (plannerVal === null) plannerVal = 'planner';
  var myInput = document.getElementById('titleMyInput');
  var plannerInput = document.getElementById('titlePlannerInput');
  if (myInput) myInput.value = myVal;
  if (plannerInput) plannerInput.value = plannerVal;
  // 색상 적용 + 프리뷰 span 롱프레스 바인딩 (입력창 롱프레스 제거)
  updateTitlePreview();
  var previewMy = document.getElementById('titlePreviewMy');
  var previewPlanner = document.getElementById('titlePreviewPlanner');
  if (previewMy) _bindPreviewLongPress(previewMy, 'my');
  if (previewPlanner) _bindPreviewLongPress(previewPlanner, 'planner');
  // 팔레트 바깥 클릭 시 닫기
  document.addEventListener('click', function(e) {
    var palette = document.getElementById('titleColorPalette');
    if (palette && palette.style.display !== 'none' &&
        !palette.contains(e.target) &&
        e.target.id !== 'titleMyInput' &&
        e.target.id !== 'titlePlannerInput') {
      closeTitleColorPalette();
    }
  });
}

// ── 다크 모드 ──────────────────────────────────────────
function setDarkMode(enabled) {
  localStorage.setItem('darkMode', enabled ? 'true' : 'false');
  applyDarkMode();
  applyIconStyle();
  applyTitle();
}

function applyDarkMode() {
  var enabled = localStorage.getItem('darkMode') === 'true';
  if (enabled) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  var toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = enabled;
  applyIconStyle();
  // 타이틀 색상 처리
  var themeColor = localStorage.getItem('themeColor') || '#6C63FF';
  var titleColor;
  if (!enabled) {
    titleColor = ''; // 라이트모드: CSS 기본값
  } else if (themeColor === '#334155') {
    titleColor = '#FFFFFF'; // 그레이+다크: 흰색
  } else {
    titleColor = themeColor; // 다른테마+다크: 테마색
  }
  ['appTitle','titleMy','titlePlanner'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      if (titleColor) {
        el.style.setProperty('color', titleColor, 'important');
      } else {
        el.style.removeProperty('color');
      }
    }
  });
}

function setTheme(c) {
  document.documentElement.style.setProperty('--primary', c);
  localStorage.setItem('themeColor', c);
  applyMenuTheme(c);
  var svgMode = localStorage.getItem('svgColorMode') || 'on';
  var isGray = c === '#334155';
  if (isGray) {
    // 그레이: 저장된 SVG 색상 초기화 (이전 랜덤값 제거)
    localStorage.removeItem('svgColorsCustom');
    SVG_COLORS = ['#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8','#94a3b8'];
  } else if (svgMode === 'on') {
    // Individual 모드: 테마 기반 SVG 색상 자동 랜덤 반영
    randomizeSvgColors(true);
  }
  applyIconStyle();
  applyDarkMode();
  addRecentThemeColor(c);
  renderThemeRecentColors();
}

// 6가지 고정 테마 색상
var THEME_COLORS = [
  '#334155', // gray (slate-700)
  '#f87171', // rose
  '#fb923c', // orange
  '#F9A8D3', // pink
  '#7dd3c0', // mint/teal
  '#93c5fd', // blue
  '#c4b5fd'  // lavender
];

// 최근 선택 색상 — 6가지 고정 색상 그대로 반환
function getRecentThemeColors() {
  return THEME_COLORS.slice();
}

function addRecentThemeColor(hex) {
  // 6개 고정이므로 별도 저장 불필요 (호환 위해 stub 유지)
}

function renderThemeRecentColors() {
  var wrap = document.getElementById('themeRecentColors');
  if (!wrap) return;
  wrap.innerHTML = '';
  var cur = localStorage.getItem('themeColor') || THEME_COLORS[0];
  THEME_COLORS.forEach(function(hex) {
    var btn = document.createElement('button');
    btn.className = 'theme-swatch-btn' + (hex === cur ? ' theme-swatch-active' : '');
    btn.style.background = hex;
    btn.onclick = function() { setTheme(hex); };
    wrap.appendChild(btn);
  });
}

// 팔레트 팝업 관련 함수들 — 호환 stub (HTML이 제거되어 호출되지 않음)
function applyThemeBtnBorder(c) { renderThemeRecentColors(); }

function applyMenuTheme(c) {
  var isGray = (c === '#334155');
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

// ── 공유 인프라 ───────────────────────────────────────
// 일반 앱(메모/할일/달력/통계)의 데이터 공유 대상을 단일 친구 코드로 통합 관리.
// 공유 대상 조회.
// 정합성:
// - 저장된 shareTarget이 현재 친구 목록에 없으면 무효 처리하고 null 반환 (자동 폴백 없음)
// - 비어 있으면 null 반환 → 공유 비활성, 완전 로컬 동작
// - 공유 대상은 사용자가 채팅 설정에서 명시적으로 선택해야만 활성화됨
function getShareTarget() {
  var friends = [];
  try { friends = JSON.parse(localStorage.getItem('friends') || '[]'); } catch(e) {}

  var t = localStorage.getItem('shareTarget');
  if (t && friends.indexOf(t) >= 0) return t;       // 유효
  if (t && friends.indexOf(t) < 0) {                 // stale → 정리
    localStorage.removeItem('shareTarget');
  }
  return null;
}

// 공유 대상 변경 (Q2: 회수 + 재배포)
// 1) 이전 대상의 모든 공유 문서를 비움 (메모/할일/달력/통계 sid 각각)
// 2) shareTarget 갱신
// 3) 새 대상에게 현재 로컬 데이터를 재배포 (단, 메모는 shared:true인 것만)
// opts.silent=true일 때 새 대상에게 승인 요청을 보내지 않음 (acceptShareRequest 경로)
async function setShareTarget(newTarget, opts) {
  if (!myCode) return;
  opts = opts || {};
  var oldTarget = localStorage.getItem('shareTarget');
  if (oldTarget === newTarget) return;

  // 1) 이전 대상으로부터 회수
  if (oldTarget) {
    var oldSids = {
      memo: [myCode, oldTarget].sort().join('_memo_'),
      todo: [myCode, oldTarget].sort().join('_todo_'),
      cal:  [myCode, oldTarget].sort().join('_cal_'),
      stats:[myCode, oldTarget].sort().join('_stat_')
    };
    try {
      // 메모: 빈 배열로 set → 상대 측 onSnapshot에서 받은 메모 사라짐
      await db.collection('memos_shared').doc(oldSids.memo).set({
        memos: [], updatedBy: myCode, ts: firebase.firestore.Timestamp.now()
      });
    } catch(e) { console.log('[SHARE] memo recall error:', e.message); }
    // 할일/달력/통계는 양방향 공유 데이터라 함부로 비우면 안 됨.
    // 대신 새 대상에게 재push되므로 자연스럽게 분리됨. (이전 대상의 문서는 그대로 남되 더 이상 갱신 안 됨)
  }

  // 2) 대상 갱신
  if (newTarget) {
    localStorage.setItem('shareTarget', newTarget);
  } else {
    localStorage.removeItem('shareTarget');
  }

  // 3) 새 대상으로 재배포
  if (newTarget) {
    // 메모: 내가 shared:true로 표시한 것만
    try { await saveSharedMemosToFirestore(); } catch(e) { console.log('[SHARE] memo push error:', e.message); }
    // 할일: 현재 로컬 todos 전체 push
    try { await saveTodosToFirestore(); } catch(e) { console.log('[SHARE] todo push error:', e.message); }
    // 달력/통계: 기존 함수가 있으면 호출 (현재 코드엔 별도 push 함수가 없고 sync 시점에 set)

    // 4) 상대에게 공유 요청 푸시 (silent=true면 건너뜀: 이미 상대가 요청을 보낸 응답으로 진입한 경로)
    if (!opts.silent) {
      try { await sendShareRequest(newTarget); } catch(e) { console.log('[SHARE_REQ] send fail:', e.message); }
    }
  }
}

// ── 공유 요청/응답 ──────────────────────────────────────
// 사용자 A가 B를 공유 대상으로 지정 → B에게 승인 요청 전송 → B 응답에 따라 쌍방 또는 일방.
//
// Firestore 구조:
//   shareRequests/{toCode}_{fromCode}_req → {from, to, ts, status: 'pending'}
//   shareRequests/{fromCode}_{toCode}_resp → {from, to, ts, status: 'accepted'|'rejected'}
// (req와 resp를 분리해서 양방향 리스너 충돌 방지)
//
// 요청은 24시간 TTL.

var REQ_TTL_MS = 24 * 60 * 60 * 1000;
var shareReqListener = null;
var shareRespListener = null;

// A가 B를 공유 대상으로 지정한 직후 호출 (setShareTarget 내부에서 호출됨)
async function sendShareRequest(toCode) {
  if (!myCode || !toCode || toCode === myCode) return;
  try {
    var reqId = toCode + '_' + myCode + '_req';
    await db.collection('shareRequests').doc(reqId).set({
      from: myCode, to: toCode,
      ts: firebase.firestore.Timestamp.now(),
      status: 'pending'
    });
  } catch(e) { console.log('[SHARE_REQ] send error:', e.message); }
}

// B가 승인 또는 거절 시 응답 문서 작성 + 요청 문서 삭제
async function sendShareResponse(fromCode, accepted) {
  if (!myCode || !fromCode) return;
  try {
    // 응답 작성 (A가 구독 중)
    var respId = fromCode + '_' + myCode + '_resp';
    await db.collection('shareRequests').doc(respId).set({
      from: myCode, to: fromCode,
      ts: firebase.firestore.Timestamp.now(),
      status: accepted ? 'accepted' : 'rejected'
    });
    // 원본 요청 삭제
    var reqId = myCode + '_' + fromCode + '_req';
    await db.collection('shareRequests').doc(reqId).delete().catch(function(){});
  } catch(e) { console.log('[SHARE_REQ] resp error:', e.message); }
}

// B 측 리스너: 나에게 온 요청 감시
function startShareRequestListener() {
  if (shareReqListener) { try { shareReqListener(); } catch(e){} shareReqListener = null; }
  if (!myCode) return;
  // Firestore 보안 규칙이 if true라 단순 컬렉션 쿼리로 처리
  shareReqListener = db.collection('shareRequests')
    .where('to', '==', myCode)
    .where('status', '==', 'pending')
    .onSnapshot(function(snap) {
      snap.docChanges().forEach(function(change) {
        if (change.type !== 'added' && change.type !== 'modified') return;
        var data = change.doc.data();
        if (!data || data.status !== 'pending') return;

        // TTL 검사: 24시간 초과면 무시 + 삭제
        var reqTs = data.ts ? data.ts.toMillis() : 0;
        if (Date.now() - reqTs > REQ_TTL_MS) {
          change.doc.ref.delete().catch(function(){});
          return;
        }

        // 친구가 아니면 무시
        var f = [];
        try { f = JSON.parse(localStorage.getItem('friends') || '[]'); } catch(e) {}
        if (f.indexOf(data.from) < 0) return;

        // 이미 모달 떠 있으면 무시 (스팸 방지)
        if (document.getElementById('shareReqModal').style.display === 'flex') return;

        showShareRequestModal(data.from);
      });
    }, function(err) { console.log('[SHARE_REQ] listener err:', err && err.message); });
}

// A 측 리스너: 내가 보낸 요청에 대한 응답 감시
function startShareResponseListener() {
  if (shareRespListener) { try { shareRespListener(); } catch(e){} shareRespListener = null; }
  if (!myCode) return;
  shareRespListener = db.collection('shareRequests')
    .where('to', '==', myCode)
    .where('status', 'in', ['accepted', 'rejected'])
    .onSnapshot(function(snap) {
      snap.docChanges().forEach(function(change) {
        if (change.type !== 'added' && change.type !== 'modified') return;
        var data = change.doc.data();
        if (!data) return;
        // 응답 도착 → 인앱 알림 표시 후 문서 삭제
        var lang = localStorage.getItem('lang') || 'ko';
        var msg;
        if (data.status === 'accepted') {
          if (lang === 'en') msg = data.from + ' accepted your share request';
          else if (lang === 'zh') msg = data.from + ' 已同意您的共享请求';
          else if (lang === 'ja') msg = data.from + ' さんが共有リクエストを承認しました';
          else msg = data.from + '님이 공유 요청을 승인했습니다';
        } else {
          if (lang === 'en') msg = data.from + ' rejected your share request';
          else if (lang === 'zh') msg = data.from + ' 已拒绝您的共享请求';
          else if (lang === 'ja') msg = data.from + ' さんが共有リクエストを拒否しました';
          else msg = data.from + '님이 공유 요청을 거절했습니다';
        }
        try { showAlert(msg); } catch(e) {}
        // 응답 문서 정리 (반복 트리거 방지)
        change.doc.ref.delete().catch(function(){});
      });
    }, function(err) { console.log('[SHARE_RESP] listener err:', err && err.message); });
}

// 요청 받았을 때 표시되는 모달
function showShareRequestModal(fromCode) {
  var modal = document.getElementById('shareReqModal');
  if (!modal) return;
  document.getElementById('shareReqFromCode').textContent = fromCode;
  // 현재 공유 대상이 있으면 경고 메시지 표시
  var currentTarget = localStorage.getItem('shareTarget');
  var warnEl = document.getElementById('shareReqWarn');
  if (warnEl) {
    if (currentTarget && currentTarget !== fromCode) {
      warnEl.style.display = '';
      var lang = localStorage.getItem('lang') || 'ko';
      if (lang === 'en') warnEl.textContent = 'Current share target (' + currentTarget + ') will be released.';
      else if (lang === 'zh') warnEl.textContent = '当前共享对象 (' + currentTarget + ') 将自动解除。';
      else if (lang === 'ja') warnEl.textContent = '現在の共有相手 (' + currentTarget + ') は自動解除されます。';
      else warnEl.textContent = '현재 공유 대상(' + currentTarget + ')은 자동 해제됩니다.';
    } else {
      warnEl.style.display = 'none';
    }
  }
  modal.dataset.fromCode = fromCode;
  modal.style.display = 'flex';
}

async function acceptShareRequest() {
  var modal = document.getElementById('shareReqModal');
  if (!modal) return;
  var fromCode = modal.dataset.fromCode;
  modal.style.display = 'none';
  if (!fromCode) return;
  try { showUploadStatus(__T('Changing share target...','공유 대상 변경 중...','正在更改共享对象...','共有相手を変更中...')); } catch(e) {}
  try {
    // setShareTarget이 회수+재배포 처리. 단 acceptShareRequest 경로에서는
    // 다시 요청을 보내지 않도록 silent 옵션 전달
    await setShareTarget(fromCode, { silent: true });
  } catch(e) {}
  try { await sendShareResponse(fromCode, true); } catch(e) {}
  try { hideUploadStatus(); } catch(e) {}
  try { updateShareTargetDisplay(); } catch(e) {}
}

async function rejectShareRequest() {
  var modal = document.getElementById('shareReqModal');
  if (!modal) return;
  var fromCode = modal.dataset.fromCode;
  modal.style.display = 'none';
  if (!fromCode) return;
  try { await sendShareResponse(fromCode, false); } catch(e) {}
}

// ── 할 일 ───────────────────────────────────────────
function getSharedTodoId() {
  if (!myCode) return null;
  var target = getShareTarget();
  if (!target) return null;
  return [myCode, target].sort().join('_todo_');
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
          if (localStorage.getItem('notifApp') === 'true') sendNotification(__T('To-Do','할 일','待办','タスク'), __T('New task added','새로운 할 일이 있어요','有新的待办事项','新しいタスクがあります'));
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
  if (!todos.length) { el.innerHTML = '<div class="empty-state">' + (__T('No tasks yet','할 일이 없습니다','暂无任务','タスクがありません')) + '</div>'; return; }
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
// ── 메모 (contenteditable 방식) ──────────────────────────────

function openMemo() { renderMemoList(); showScreen('memoScreen'); }

// 메모 데이터 마이그레이션:
// 기존 메모에 id/owner/shared/ts 자동 추가.
// - id: 마이그레이션 시점 기준 고유값 생성
// - owner: myCode (이 단말에서 만든 것으로 간주)
// - shared: false (기본 비공유)
// - ts: date에서 파싱 시도, 실패 시 현재 시각
// 반환값: 변환 후 배열. localStorage 갱신은 호출측에서 결정.
function migrateMemos(memos) {
  var changed = false;
  var now = Date.now();
  memos.forEach(function(m, idx) {
    if (!m.id) {
      // 인덱스 + now로 어느 정도 시간 분리. 작은 음수 오프셋으로 오래된 항목이 뒤에 오게.
      m.id = (now - idx) + '_' + Math.random().toString(36).slice(2,8);
      changed = true;
    }
    if (!('owner' in m)) {
      m.owner = myCode || '';
      changed = true;
    }
    if (!('shared' in m)) {
      m.shared = false;
      changed = true;
    }
    if (!('ts' in m)) {
      // date 문자열을 파싱 시도 (ko-KR: "YYYY. M. D." 등). 실패 시 인덱스 보정
      var ts = NaN;
      if (m.date) {
        var d = new Date(m.date);
        if (!isNaN(d.getTime())) ts = d.getTime();
      }
      if (isNaN(ts)) ts = now - idx * 1000; // 인덱스 순서 보존
      m.ts = ts;
      changed = true;
    }
  });
  return { memos: memos, changed: changed };
}

// 로컬 메모 로드: 마이그레이션 + 변경 시 즉시 저장
function loadMemos() {
  var memos = [];
  try { memos = JSON.parse(localStorage.getItem('memos') || '[]'); } catch(e) {}
  var r = migrateMemos(memos);
  if (r.changed) localStorage.setItem('memos', JSON.stringify(r.memos));
  return r.memos;
}

function renderMemoList() {
  // 마이그레이션 적용 + ts 내림차순 정렬
  var memos = loadMemos();
  memos.sort(function(a,b) { return (b.ts||0) - (a.ts||0); });

  const el = document.getElementById('memoList');
  var isEn = localStorage.getItem('lang') === 'en';
  if (!memos.length) { el.innerHTML = '<div class="empty-state">' + (__T('No memos yet','메모가 없습니다','暂无备忘录','メモがありません')) + '</div>'; return; }
  el.innerHTML = memos.map(function(m) {
    // 본문 미리보기: HTML에서 텍스트만 추출
    const tmp = document.createElement('div');
    tmp.innerHTML = m.body || '';
    const preview = tmp.textContent.substring(0, 80);
    // 본문 내 첫 이미지 추출
    const imgMatch = (m.body || '').match(/<img[^>]+src="([^"]+)"/);
    const thumb = imgMatch ? `<div class="memo-card-imgs"><img class="memo-card-img-thumb" src="${imgMatch[1]}"></div>` : '';


    // 공유 상태 아이콘 (SVG, 정R=1.5 arc 라운드, 바깥쪽 볼록)
    // 꼭짓점: 위(8,2) 좌하(1.5,14) 우하(14.5,14) — sweep-flag=0
    var _UP = 'M9.319 4.435 A1.5 1.5 0 0 0 6.681 4.435 L2.699 11.786 A1.5 1.5 0 0 0 4.018 14 L11.982 14 A1.5 1.5 0 0 0 13.301 11.786 L9.319 4.435 Z';
    var _DN = 'M6.681 11.565 A1.5 1.5 0 0 0 9.319 11.565 L13.301 4.214 A1.5 1.5 0 0 0 11.982 2 L4.018 2 A1.5 1.5 0 0 0 2.699 4.214 L6.681 11.565 Z';

    var SVG_TRIANGLE_LINE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="' + _UP + '"/></svg>';
    var SVG_TRIANGLE_UP   = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="' + _UP + '" fill="currentColor"/></svg>';
    var SVG_TRIANGLE_DOWN = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="' + _DN + '" fill="currentColor"/></svg>';

    var isReceived = !!m.from;
    var shareIcon, shareCls, shareOnclick;
    if (isReceived) {
      shareIcon = SVG_TRIANGLE_DOWN;
      shareCls = 'memo-share-icon memo-share-received';
      shareOnclick = '';
    } else if (m.shared) {
      shareIcon = SVG_TRIANGLE_UP;
      shareCls = 'memo-share-icon memo-share-on';
      shareOnclick = 'onclick="event.stopPropagation();toggleMemoShare(\'' + esc(m.id) + '\')"';
    } else {
      shareIcon = SVG_TRIANGLE_LINE;
      shareCls = 'memo-share-icon memo-share-off';
      shareOnclick = 'onclick="event.stopPropagation();toggleMemoShare(\'' + esc(m.id) + '\')"';
    }

    return `
    <div class="memo-card" onclick="openEditMemo('${esc(m.id)}')">
      <div class="memo-card-title">${esc(m.title||__T('Untitled','제목 없음','无标题','タイトルなし'))}</div>
      <div class="memo-card-preview">${esc(preview)}</div>
      ${thumb}
      <div class="memo-card-footer">
        <span class="memo-card-date">${m.date||''}</span>
        <button class="${shareCls}" ${shareOnclick} aria-label="share">${shareIcon}</button>
        <button class="memo-del" onclick="event.stopPropagation();deleteMemo('${esc(m.id)}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

// ── 메모 자동 제목 ─────────────────────────────────────────
let memoAutoTitle = true;

document.addEventListener('DOMContentLoaded', function() {
  const contentEl = document.getElementById('memoContentInput');
  const titleEl = document.getElementById('memoTitleInput');
  if (!contentEl || !titleEl) return;

  contentEl.addEventListener('input', function() {
    if (!memoAutoTitle) return;
    const text = contentEl.innerText || '';
    const firstLine = text.split('\n')[0].trim();
    const tokens = firstLine.match(/\S+/g) || [];
    titleEl.value = tokens.slice(0, 10).join(' ');
  });

  // 클립보드에서 이미지 붙여넣기 (스크린샷, 웹 이미지 복사 등)
  // - 클립보드에 이미지가 있으면 가로채서 Firebase Storage에 업로드 후 본문에 삽입
  // - 텍스트만 있는 paste는 기본 동작(contenteditable 자체 처리) 유지
  contentEl.addEventListener('paste', function(e) {
    // 받은 메모(읽기 전용) 편집 시에는 paste 차단
    if (contentEl.getAttribute('contenteditable') === 'false') {
      e.preventDefault();
      return;
    }
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;

    // items에서 이미지 추출 (PNG/JPEG/GIF/WebP 등)
    const items = cd.items ? Array.from(cd.items) : [];
    const imageItems = items.filter(function(it) {
      return it.kind === 'file' && it.type && it.type.indexOf('image/') === 0;
    });
    if (!imageItems.length) return; // 이미지 없음 → 기본 텍스트 paste 진행

    // 이미지가 하나라도 있으면 기본 paste 동작 차단하고 직접 처리
    e.preventDefault();

    // paste 시점의 selection을 보존 (업로드 비동기 동안 사용자가 다른 곳 누를 수 있음)
    const sel = window.getSelection();
    let savedRange = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      // 에디터 내부일 때만 보존
      if (contentEl.contains(r.startContainer)) savedRange = r.cloneRange();
    }

    // 보조 텍스트(이미지와 같이 복사된 텍스트)는 함께 삽입
    const pastedText = cd.getData ? cd.getData('text/plain') : '';
    if (pastedText && savedRange) {
      try {
        savedRange.deleteContents();
        savedRange.insertNode(document.createTextNode(pastedText));
        savedRange.collapse(false);
      } catch(err) {}
    }

    // 업로드 시작 표시
    try { showUploadStatus(__T('Uploading image...','이미지 업로드 중...','正在上传图片...','画像をアップロード中...')); } catch(err) {}
    let pending = imageItems.length;

    imageItems.forEach(function(it) {
      const file = it.getAsFile();
      if (!file) { pending--; return; }

      // 업로드 직전에 저장된 selection을 복원해 두면
      // 기존 insertImgAtCursor가 현재 selection 위치에 이미지를 삽입함
      uploadMemoImgAtRange(file, savedRange).finally(function() {
        pending--;
        if (pending <= 0) {
          try { hideUploadStatus(); } catch(err) {}
          // 자동 제목 갱신 (텍스트가 같이 paste된 경우 대비)
          if (memoAutoTitle) {
            const text = contentEl.innerText || '';
            const firstLine = text.split('\n')[0].trim();
            const tokens = firstLine.match(/\S+/g) || [];
            titleEl.value = tokens.slice(0, 10).join(' ');
          }
        }
      });
    });
  });

  titleEl.addEventListener('input', function() {
    memoAutoTitle = (titleEl.value === '');
  });
});

function clearMemoTitle() {
  const titleEl = document.getElementById('memoTitleInput');
  if (!titleEl) return;
  titleEl.value = '';
  memoAutoTitle = true;
  titleEl.focus();
}

// 편집 중인 메모 ID. null이면 새 메모. 기존 editingMemoIndex 변수는 호환 위해 두지만 이 함수들에선 사용 안 함.
var editingMemoId = null;

function openNewMemo() {
  editingMemoId = null;
  editingMemoIndex = null;
  const en = localStorage.getItem('lang') === 'en';
  document.getElementById('memoEditorTitle').textContent = __T('New Memo','새 메모','新建备忘','新規メモ');
  document.getElementById('memoEditorTitle').style.fontWeight = __T('800','400','800','800');
  document.getElementById('memoTitleInput').value = '';
  document.getElementById('memoContentInput').innerHTML = '';
  // 새 메모는 항상 편집 가능 상태로 초기화
  applyMemoEditorReadonly(false);
  memoAutoTitle = true;
  showScreen('memoEditorScreen');
}

// 메모 에디터를 읽기 전용/편집 가능으로 전환
// readonly=true (받은 메모): 편집 차단, 텍스트 선택만 허용, 저장 버튼을 Close 버튼으로 교체
// readonly=false: 편집 가능 (기본)
function applyMemoEditorReadonly(readonly) {
  var titleEl = document.getElementById('memoTitleInput');
  var contentEl = document.getElementById('memoContentInput');
  var saveBtn = document.getElementById('memoSaveBtn');
  var toolbar = document.getElementById('memoImgToolbar');
  var clearBtn = document.getElementById('memoTitleClear');
  if (!titleEl || !contentEl) return;
  var en = localStorage.getItem('lang') === 'en';
  if (readonly) {
    titleEl.setAttribute('readonly', 'readonly');
    contentEl.setAttribute('contenteditable', 'false');
    // 편집 caret은 숨기되 텍스트 선택은 가능 (브라우저 기본 동작)
    contentEl.style.caretColor = 'transparent';
    contentEl.style.outline = 'none';
    contentEl.style.userSelect = 'text';
    contentEl.style.webkitUserSelect = 'text';
    if (toolbar) toolbar.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
    // 저장 버튼을 Close로 변환 (같은 자리에 그대로 두고 텍스트/핸들러만 교체)
    if (saveBtn) {
      saveBtn.style.display = '';
      saveBtn.textContent = __T('Close','닫기','关闭','閉じる');
      saveBtn.setAttribute('onclick', 'closeMemoEditor()');
      saveBtn.dataset.mode = 'close';
    }
  } else {
    titleEl.removeAttribute('readonly');
    contentEl.setAttribute('contenteditable', 'true');
    contentEl.style.caretColor = '';
    contentEl.style.outline = '';
    contentEl.style.userSelect = '';
    contentEl.style.webkitUserSelect = '';
    if (toolbar) toolbar.style.display = '';
    if (clearBtn) clearBtn.style.display = '';
    // Close 버튼이었으면 다시 저장 버튼으로 복원
    if (saveBtn) {
      saveBtn.style.display = '';
      saveBtn.textContent = __T('Save','저장','保存','保存');
      saveBtn.setAttribute('onclick', 'saveMemo()');
      saveBtn.dataset.mode = 'save';
    }
  }
}

function openEditMemo(id) {
  // 호환성: 숫자가 들어오면 인덱스로 처리 (구버전 호출 흔적 방어)
  var memos = loadMemos();
  memos.sort(function(a,b) { return (b.ts||0) - (a.ts||0); });
  var memo = null;
  if (typeof id === 'number') {
    memo = memos[id];
  } else {
    memo = memos.find(function(m) { return m.id === id; });
  }
  if (!memo) return;

  editingMemoId = memo.id;
  editingMemoIndex = null; // 인덱스 기반 식별 폐기

  const en = localStorage.getItem('lang') === 'en';
  var isReceived = !!memo.from;
  // 받은 메모: 뷰어 모드 / 내 메모: 편집 모드
  var headerText = isReceived
    ? (__T('View Memo','메모 보기','查看备忘','メモを表示'))
    : (__T('Edit Memo','메모 편집','编辑备忘','メモを編集'));
  document.getElementById('memoEditorTitle').textContent = headerText;
  document.getElementById('memoEditorTitle').style.fontWeight = __T('800','400','800','800');
  document.getElementById('memoTitleInput').value = memo.title || '';
  // body(HTML) 우선, 없으면 구버전 content(텍스트) 폴백
  const body = memo.body || (memo.content ? memo.content.replace(/\n/g,'<br>') : '');
  document.getElementById('memoContentInput').innerHTML = body;
  memoAutoTitle = false;

  // 받은 메모는 읽기 전용 (편집 진입 X, Close 버튼 표시)
  applyMemoEditorReadonly(isReceived);

  setTimeout(bindAllMemoImgPinch, 50);
  showScreen('memoEditorScreen');
}

function closeMemoEditor() { renderMemoList(); showScreen('memoScreen'); }

function saveMemo() {
  const title = document.getElementById('memoTitleInput').value.trim();
  const body = document.getElementById('memoContentInput').innerHTML.trim();
  const textOnly = (document.getElementById('memoContentInput').innerText || '').trim();
  if (!title && !textOnly) {
    var _ml = localStorage.getItem('lang') || 'ko';
    var _mm;
    if (_ml === 'en') _mm = 'Please enter content';
    else if (_ml === 'zh') _mm = '请输入内容';
    else if (_ml === 'ja') _mm = '内容を入力してください';
    else _mm = '내용을 입력하세요';
    showAlert(_mm);
    return;
  }

  var memos = loadMemos();
  const date = new Date().toLocaleDateString(_locForLang(localStorage.getItem('lang')||'ko'));
  var now = Date.now();

  if (editingMemoId) {
    // 기존 메모 수정 — 받은 메모는 저장 안 됨 (UI에서 저장버튼 숨겨두긴 했지만 방어)
    var idx = memos.findIndex(function(m) { return m.id === editingMemoId; });
    if (idx >= 0) {
      if (memos[idx].from) return; // 받은 메모는 수정 금지
      memos[idx].title = title;
      memos[idx].body = body;
      memos[idx].date = date;
      memos[idx].ts = now;
      // shared 유지, owner 유지
    }
  } else {
    // 새 메모
    memos.unshift({
      id: now + '_' + Math.random().toString(36).slice(2,8),
      owner: myCode || '',
      shared: false,
      title: title,
      body: body,
      date: date,
      ts: now
    });
  }

  localStorage.setItem('memos', JSON.stringify(memos));
  // 공유 중인 메모를 수정했다면 Firestore에도 반영
  saveSharedMemosToFirestore();
  closeMemoEditor();
}

function deleteMemo(id) {
  // 호환성: 숫자 인덱스도 받아줌
  showConfirm(__T('Delete memo?','메모를 삭제할까요?','删除备忘?','メモを削除しますか?'), function() {
    var memos = loadMemos();
    if (typeof id === 'number') {
      // 인덱스: 정렬된 화면 기준이므로 그 정렬을 한 번 더 적용해야 동일 항목
      memos.sort(function(a,b) { return (b.ts||0) - (a.ts||0); });
      memos.splice(id, 1);
    } else {
      var idx = memos.findIndex(function(m) { return m.id === id; });
      if (idx >= 0) memos.splice(idx, 1);
    }
    localStorage.setItem('memos', JSON.stringify(memos));
    // 내가 공유 중이던 메모를 지웠다면 Firestore에서도 회수
    saveSharedMemosToFirestore();
    renderMemoList();
  });
}

// 공유 토글: 내 메모만 대상. 받은 메모는 토글 불가.
// 공유 대상이 없으면 알림 없이 조용히 무시.
function toggleMemoShare(id) {
  var memos = loadMemos();
  var idx = memos.findIndex(function(m) { return m.id === id; });
  if (idx < 0) return;
  if (memos[idx].from) return; // 받은 메모는 토글 불가
  if (!getShareTarget()) return; // 공유 대상 없으면 조용히 무시

  memos[idx].shared = !memos[idx].shared;
  // 토글 시 ts 갱신하지 않음 (정렬 위치 안 바뀜)
  localStorage.setItem('memos', JSON.stringify(memos));
  saveSharedMemosToFirestore();
  renderMemoList();
}

// ── 메모 Firestore 동기화 ────────────────────────────────────
var memoListener = null;

// 내가 공유 ON으로 표시한 메모만 Firestore에 push
async function saveSharedMemosToFirestore() {
  if (!myCode) return;
  var target = getShareTarget();
  if (!target) return;
  var sid = [myCode, target].sort().join('_memo_');

  var memos = loadMemos();
  // 내가 작성했고(shared:true) 받은 메모(from 없음)인 것만 골라서 전송
  var outgoing = memos.filter(function(m) { return m.shared && !m.from; })
                      .map(function(m) {
                        // 상대 입장에서 보일 데이터만 (owner는 상대에게도 보임)
                        return {
                          id: m.id, owner: myCode,
                          title: m.title || '', body: m.body || '',
                          date: m.date || '', ts: m.ts || Date.now()
                        };
                      });
  try {
    await db.collection('memos_shared').doc(sid).set({
      memos: outgoing, updatedBy: myCode, ts: firebase.firestore.Timestamp.now()
    });
  } catch(e) {
    console.log('[MEMO] save error:', e.message);
  }
}

// 상대가 공유한 메모를 받아 로컬과 머지
function applyIncomingSharedMemos(incoming, fromCode) {
  // 1) 내 로컬에서 이 sender(fromCode)로부터 받았던 메모들의 ID 집합
  var memos = loadMemos();
  var receivedFromThisSender = memos.filter(function(m) { return m.from === fromCode; });
  var receivedIds = receivedFromThisSender.map(function(m) { return m.id; });

  // 2) incoming 배열의 ID 집합
  var incomingIds = (incoming || []).map(function(m) { return m.id; });

  // 3) 머지:
  //    - incoming에 있고 로컬에 없는 것 → 추가 (from:fromCode)
  //    - incoming에 있고 로컬에 있는 것 → 내용 갱신 (from:fromCode 유지)
  //    - incoming에 없는데 로컬에는 받은걸로 있는 것 → 상대가 공유 해제 → 로컬에서 제거
  // 새 배열 구성: (내가 소유한 메모) + (이번 sender가 아닌 다른 from의 메모) + (incoming을 from으로 변환)
  var keep = memos.filter(function(m) {
    return !m.from || m.from !== fromCode;
  });
  var fromIncoming = (incoming || []).map(function(m) {
    return {
      id: m.id,
      owner: m.owner || fromCode,
      from: fromCode,         // 받은 메모 표식
      shared: false,          // 받은 메모는 내 입장에서 공유 토글 불가
      title: m.title || '',
      body: m.body || '',
      date: m.date || '',
      ts: m.ts || Date.now()
    };
  });

  var merged = keep.concat(fromIncoming);
  localStorage.setItem('memos', JSON.stringify(merged));
}

// 메모 화면 열 때 구독 시작 (할일과 동일 패턴)
function startMemoListener() {
  if (memoListener) { try { memoListener(); } catch(e) {} memoListener = null; }
  if (!myCode) return;
  var target = getShareTarget();
  if (!target) return;
  var sid = [myCode, target].sort().join('_memo_');

  var firstLoad = true;
  memoListener = db.collection('memos_shared').doc(sid).onSnapshot(function(snap) {
    if (snap.exists) {
      var data = snap.data() || {};
      // 이 문서에는 양쪽 다 쓸 수 있지만, updatedBy가 내가 아닌 경우에만 incoming으로 처리
      // (내가 set한 직후의 echo는 무시)
      if (data.updatedBy && data.updatedBy !== myCode) {
        // updatedBy가 상대 → memos는 상대가 나에게 공유한 메모들
        applyIncomingSharedMemos(data.memos || [], data.updatedBy);
        if (!firstLoad) {
          if (localStorage.getItem('notifApp') === 'true') {
            try { sendNotification(__T('Memo','메모','备忘','メモ'), __T('New shared memo','새로운 공유 메모가 있어요','有新的共享备忘','新しい共有メモがあります')); } catch(e) {}
          }
        }
        renderMemoList();
      }
    }
    firstLoad = false;
  }, function(err) {
    console.log('[MEMO] listener error:', err && err.message);
  });
}

// openMemo 진입 시 리스너 시작 — 기존 openMemo를 확장
var _origOpenMemo = openMemo;
window.openMemo = function() {
  _origOpenMemo();
  startMemoListener();
};

// ── 공유 인텐트 → 메모 자동 저장 ─────────────────────────────
// 다른 앱에서 "공유하기 → my planner" 선택 시 호출됨.
// manifest.json의 share_target이 GET ?title=&text=&url= 로 들어옴.
// 1) 텍스트 추출 (text > url > title 우선순위)
// 2) 첫 줄에서 토큰 10개까지 자동 제목 추출 (기존 메모 입력 로직과 동일)
// 3) localStorage 'memos'에 즉시 unshift 저장
// 4) 화면을 띄우지 않고 URL을 깨끗이 정리한 뒤 창 닫기 (원래 앱으로 복귀)
function handleShareIntent() {
  try {
    const params = new URLSearchParams(window.location.search);
    const sharedTitle = (params.get('title') || '').trim();
    const sharedText  = (params.get('text')  || '').trim();
    const sharedUrl   = (params.get('url')   || '').trim();

    // 공유 파라미터가 하나도 없으면 일반 실행 → 종료
    if (!sharedTitle && !sharedText && !sharedUrl) return false;

    // 본문 합성: text 우선, 없으면 url, 그것도 없으면 title
    // 일부 브라우저는 공유 URL을 text 안에 같이 넣어주므로 중복 방지
    let body = '';
    if (sharedText && sharedUrl) {
      body = sharedText.includes(sharedUrl) ? sharedText : (sharedText + '\n' + sharedUrl);
    } else {
      body = sharedText || sharedUrl || sharedTitle;
    }
    body = body.trim();
    if (!body) return false;

    // 자동 제목 규칙: 메모 입력창과 동일하게 첫 줄의 토큰 10개까지
    // 단, 공유측에서 title을 명시적으로 보낸 경우 그것을 우선 사용
    let title;
    if (sharedTitle) {
      title = sharedTitle;
    } else {
      const firstLine = body.split('\n')[0].trim();
      const tokens = firstLine.match(/\S+/g) || [];
      title = tokens.slice(0, 10).join(' ');
    }

    // 본문을 HTML body 형식으로 저장 (메모 에디터가 innerHTML 기반이므로
    // 줄바꿈은 <br>로, HTML 특수문자는 이스케이프해서 텍스트로 보존)
    const safeBody = String(body)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const memos = JSON.parse(localStorage.getItem('memos') || '[]');
    const date = new Date().toLocaleDateString(_locForLang(localStorage.getItem('lang')||'ko'));
    var now = Date.now();
    memos.unshift({
      id: now + '_' + Math.random().toString(36).slice(2,8),
      owner: myCode || '',
      shared: false,
      title: title, body: safeBody, date: date,
      ts: now
    });
    localStorage.setItem('memos', JSON.stringify(memos));

    // URL에서 공유 파라미터 제거 (새로고침 시 중복 저장 방지)
    try {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch(e) {}

    // 원래 앱으로 복귀: PWA에서 열렸으면 창 닫기 시도
    // (Android Chrome PWA는 share_target으로 들어오면 window.close()가 동작함)
    // 실패 시 planApp 메인 화면에 머무름 (눈에 띄지 않게 토스트만)
    setTimeout(function() {
      try { window.close(); } catch(e) {}
      // window.close()가 막힌 환경 대응: 작은 안내 토스트
      try { showUploadStatus(__T('Saved to memo','메모에 저장됨','已保存到备忘','メモに保存しました')); } catch(e) {}
      setTimeout(function() { try { hideUploadStatus(); } catch(e) {} }, 1500);
    }, 50);

    return true;
  } catch(e) {
    console.log('share intent error:', e && e.message);
    return false;
  }
}

// ── 메모 이미지 업로드 ────────────────────────────────────────
async function uploadMemoImg(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    if (!currentUser) {
      await new Promise((resolve) => {
        const check = setInterval(() => { if (currentUser) { clearInterval(check); resolve(); } }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
    }
    if (!currentUser) { showAlert(__T('Auth failed - refresh and retry','인증 실패 - 새로고침 후 다시 시도하세요','认证失败 - 请刷新后重试','認証失敗 - 更新後再試行してください')); return; }
    const path = 'memo_images/' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
    const snap = await storage.ref().child(path).put(file);
    const url = await snap.ref.getDownloadURL();
    insertImgAtCursor(url);
  } catch(err) {
    showAlert(__T('Image upload failed: ','이미지 업로드 실패: ','图片上传失败: ','画像アップロード失敗: ') + err.message);
  }
}

// paste 전용: paste 시점에 저장된 Range 위치에 이미지를 삽입
// (업로드가 비동기라서 그 사이 사용자가 다른 곳을 눌러도 원래 위치를 지킴)
async function uploadMemoImgAtRange(file, savedRange) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    if (!currentUser) {
      await new Promise((resolve) => {
        const check = setInterval(() => { if (currentUser) { clearInterval(check); resolve(); } }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
    }
    if (!currentUser) { showAlert(__T('Auth failed - refresh and retry','인증 실패 - 새로고침 후 다시 시도하세요','认证失败 - 请刷新后重试','認証失敗 - 更新後再試行してください')); return; }
    const path = 'memo_images/' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
    const snap = await storage.ref().child(path).put(file);
    const url = await snap.ref.getDownloadURL();

    // 저장된 Range가 있으면 selection을 복원 후 삽입,
    // 없거나 끊겼으면 기존 insertImgAtCursor 동작(현재 selection / 끝)
    const editor = document.getElementById('memoContentInput');
    if (savedRange && editor && editor.contains(savedRange.startContainer)) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } catch(err) {}
    }
    insertImgAtCursor(url);
  } catch(err) {
    showAlert(__T('Image upload failed: ','이미지 업로드 실패: ','图片上传失败: ','画像アップロード失敗: ') + err.message);
  }
}

// 커서 위치에 이미지 삽입
function insertImgAtCursor(url) {
  const editor = document.getElementById('memoContentInput');
  editor.focus();
  const img = document.createElement('img');
  img.src = url;
  img.style.maxWidth = '100%';
  img.style.borderRadius = '10px';
  img.style.margin = '4px 0';
  img.style.display = 'block';
  img.classList.add('memo-pinch-img');
  bindPinchZoom(img);
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(img);
  }
}

// ── 핀치 줌 ───────────────────────────────────────────
function bindPinchZoom(img) {
  let startDist = 0;
  let startW = 0;

  img.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      startDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      startW = img.offsetWidth;
    }
  }, { passive: false });

  img.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / startDist;
      const editorW = img.closest('#memoContentInput').offsetWidth - 36;
      let newW = Math.round(startW * ratio);
      newW = Math.max(60, Math.min(editorW, newW));
      img.style.width = newW + 'px';
      img.style.maxWidth = '100%';
    }
  }, { passive: false });
}

// 저장된 메모 불러올 때 기존 이미지에도 핀치 줌 바인딩
function bindAllMemoImgPinch() {
  const editor = document.getElementById('memoContentInput');
  if (!editor) return;
  editor.querySelectorAll('img').forEach(img => {
    if (!img._pinchBound) { img._pinchBound = true; bindPinchZoom(img); }
  });
}

function handleMemoImgSelect(e) {
  const files = Array.from(e.target.files);
  files.forEach(f => uploadMemoImg(f));
  e.target.value = '';
}


// ── 달력 ───────────────────────────────────────────
function getSharedCalId() {
  if (!myCode) return null;
  var target = getShareTarget();
  if (!target) return null;
  return [myCode, target].sort().join('_cal_');
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
          if (localStorage.getItem('notifApp') === 'true') sendNotification(__T('Calendar','달력','日历','カレンダー'), __T('New event','새 일정이 있어요','有新的日程','新しい予定があります'));
        }
        firstCalLoad = false;
      }
      renderCalendar();
    });
  } else {
    renderCalendar();
  }
}

// 색상명 → hex 맵 (분할 gradient에 사용)
const CAL_COLORS = {
  pink:'#FFB3B3', yellow:'#F5E84A', green:'#8FF087',
  blue:'#7EC8F5', purple:'#C3A8F0',
  // 구버전 호환
  done:'#FFB3B3', red:'#F5E84A'
};

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
  } else if (calLang === 'zh') {
    document.getElementById('calTitle').textContent = calYear + '年' + (calMonth+1) + '月';
  } else if (calLang === 'ja') {
    document.getElementById('calTitle').textContent = calYear + '年' + (calMonth+1) + '月';
  } else {
    document.getElementById('calTitle').textContent = calYear + '년 ' + months[calMonth];
  }
  const syncEl = document.getElementById('calSyncStatus');
  if (syncEl) syncEl.textContent = '';
  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const today = d===now.getDate() && calMonth===now.getMonth() && calYear===now.getFullYear();
    const raw = dayMap[d]; // string | [c1,c2] | undefined
    const colors = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const dow = (firstDay+d-1)%7;

    let cls = ['cal-day', today ? 'cal-today' : '', dow===0?'sun':dow===6?'sat':''];
    let inlineStyle = '';

    if (colors.length === 2) {
      // 세로 반분할
      const c1 = CAL_COLORS[colors[0]] || colors[0];
      const c2 = CAL_COLORS[colors[1]] || colors[1];
      inlineStyle = `style="background:linear-gradient(to right,${c1} 50%,${c2} 50%)!important"`;
      cls.push('cal-split');
    } else if (colors.length === 1) {
      cls.push(`cal-color-${colors[0]}`);
    }

    cls = cls.filter(Boolean).join(' ');
    html += `<div class="${cls}" ${inlineStyle} ontouchend="toggleHabit(${d},event);" onclick="toggleHabit(${d},event);">${d}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  const doneCount = Object.values(dayMap).filter(v => v && v !== 'clear' && !(Array.isArray(v) && v.length === 0)).length;
  const sorted = Object.keys(dayMap).map(Number).sort((a,b)=>b-a);
  let streak = 0;
  if (sorted.length) { streak = 1; for (let i=0;i<sorted.length-1;i++){if(sorted[i]-sorted[i+1]===1)streak++;else break;} }
  document.getElementById('calDoneCount').textContent = doneCount;
  document.getElementById('calRate').textContent = Math.round(doneCount/daysInMonth*100)+'%';
  document.getElementById('calStreak').textContent = streak;
}

let selectedPalette = 'pink';

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

let _habitLastTouch = 0; // 중복 이벤트(touchend+click) 방지용

async function toggleHabit(day, e) {
  // touchend 이후 300ms 내 click 이벤트 무시 (모바일 이중 호출 방지)
  const now = Date.now();
  if (e && e.type === 'touchend') {
    e.preventDefault();
    _habitLastTouch = now;
  } else if (e && e.type === 'click') {
    if (now - _habitLastTouch < 400) return; // touchend가 이미 처리함
  }

  if (!selectedPalette) return;
  const habits = JSON.parse(localStorage.getItem('habits') || '{}');
  const key = `${calYear}-${calMonth}`;
  if (!habits[key]) habits[key] = {};
  // 이전 버전 배열 호환
  if (Array.isArray(habits[key])) {
    const arr = habits[key]; habits[key] = {};
    arr.forEach(d => { habits[key][d] = 'done'; });
  }

  if (selectedPalette === 'clear') {
    // 지우개: 무조건 삭제
    delete habits[key][day];
  } else {
    const cur = habits[key][day];
    const curColors = Array.isArray(cur) ? cur : (cur ? [cur] : []);

    if (curColors.length === 0) {
      // 빈 날 → 단색 마킹
      habits[key][day] = selectedPalette;
    } else if (curColors.length === 1) {
      if (curColors[0] === selectedPalette) {
        // 같은 색 재입력 → 무시
        return;
      } else {
        // 다른 색 → 입력 순서대로 반반 분할
        habits[key][day] = [curColors[0], selectedPalette];
      }
    } else {
      // 이미 2색 → 재입력 무시
      return;
    }
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
    document.getElementById('chatSetup').style.display = 'none';
    var f = JSON.parse(localStorage.getItem('friends') || '[]');
    if (f.length === 1) {
      listenFriendChanges();
      openChat(f[0]);
    } else {
      showFriendList();
    }
  }
}

function exitChat() {
  if (messageListener) { messageListener(); messageListener = null; }
  if (friendsListener) { friendsListener(); friendsListener = null; }
  if (roomListener) { roomListener(); roomListener = null; }
  if (calListener) { calListener(); calListener = null; }
  stopQrScanner();
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};
  showScreen('planApp');
}

async function saveMyCode() {
  const code = document.getElementById('myCodeInput').value.trim().toUpperCase();
  if (!code || code.length < 2) {
    showAlert(__T('At least 2 chars required','2자 이상 입력하세요','请输入至少2个字符','2文字以上入力してください'));
    return;
  }
  // 코드 중복 검증: 이미 다른 사용자가 백업해둔 코드면 거부
  try {
    var bk = await db.collection('backups').doc(code).get();
    if (bk.exists) {
      var data = bk.data() || {};
      var myHash = await patternToHash(savedPattern);
      // 본인 백업(패턴 일치)이면 복원, 아니면 거부
      if (data.patternHash === myHash) {
        var ok = await _restoreCode(code, myHash);
        if (ok) { window.location.reload(); return; }
      }
      showAlert(__T('Code already in use','이미 등록된 코드입니다','此代码已被使用','既に登録されているコードです'));
      return;
    }
  } catch(e) { console.log('[saveMyCode] check error:', e.message); }

  myCode = code; localStorage.setItem('myCode', myCode);
  db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() }, { merge: true });
  // 신규 사용자 첫 백업 트리거
  try { performBackup(); } catch(e) {}
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
    var _en = localStorage.getItem('lang')==='en';
    el.innerHTML = '<div class="no-friend">' +
      '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.35">' +
      '<circle cx="12" cy="8" r="4"/>' +
      '<path d="M5 21c0-4 3.1-7 7-7s7 3 7 7"/>' +
      '</svg>' +
      '<div>' + (__T('Add a friend to start chatting','친구를 추가하면 채팅이 시작됩니다','添加好友后可开始聊天','友達を追加するとチャットが始まります')) + '</div>' +
      '</div>';
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

// ── Firestore 자동 백업/복원 (v2: patternHash 기반) ──────────────────────────
//
// 데이터 구조:
//   backups/{myCode} = {
//     patternHash: SHA-256(현재 패턴),
//     payload: { memos, todos, ...설정 },
//     ts: Timestamp
//   }
//   patternIndex/{patternHash} = {
//     codes: [myCode, ...]   // arrayUnion/Remove로 관리
//   }
//
// 복원 흐름은 진입 시점 자동. 사용자가 명시적 호출 안 함.
// 백업 정책: 1분 디바운스, 패턴은 백업 payload 제외 (해시는 별도 필드)

var BACKUP_KEYS = [
  'memos', 'todos', 'habits', 'hStats',
  'appName', 'lang', 'darkMode', 'themeColor', 'iconStyle', 'svgColorMode', 'svgColorsCustom',
  'chatTheme', 'chatFontSize',
  'notifApp', 'notifEvent',
  'autoLock', 'autoDeleteMin',
  'shareTarget', 'friends',
  '_titleMain', '_titleSub', 'titleMyColor', 'titlePlannerColor', 'titleMySize', 'titlePlannerSize'
];

var _backupTimer = null;
var _backupInProgress = false;

function scheduleBackup() {
  if (!myCode) return;
  if (_backupTimer) clearTimeout(_backupTimer);
  _backupTimer = setTimeout(performBackup, 60000);
}

async function performBackup() {
  if (!myCode || _backupInProgress) return;
  _backupInProgress = true;
  try {
    var patternHash = await patternToHash(savedPattern);
    if (!patternHash) return;
    var payload = {};
    BACKUP_KEYS.forEach(function(k) {
      var v = localStorage.getItem(k);
      if (v !== null) payload[k] = v;
    });
    // 백업 문서 set
    await db.collection('backups').doc(myCode).set({
      patternHash: patternHash,
      payload: payload,
      ts: firebase.firestore.Timestamp.now()
    });
    // 패턴 인덱스에 내 코드 등록 (arrayUnion: 동시성 안전)
    await db.collection('patternIndex').doc(patternHash).set({
      codes: firebase.firestore.FieldValue.arrayUnion(myCode)
    }, { merge: true });
    localStorage.setItem('_lastBackup', String(Date.now()));
  } catch(e) {
    console.log('[BACKUP] error:', e.message);
  } finally {
    _backupInProgress = false;
  }
}

function flushBackup() {
  if (_backupTimer) { clearTimeout(_backupTimer); _backupTimer = null; }
  return performBackup();
}

// 페이지 닫기/숨김 시 백업 디바운스가 남아있다면 즉시 발사
window.addEventListener('pagehide', function() {
  if (_backupTimer && myCode) { clearTimeout(_backupTimer); performBackup(); }
});
window.addEventListener('beforeunload', function() {
  if (_backupTimer && myCode) { clearTimeout(_backupTimer); performBackup(); }
});
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden' && _backupTimer && myCode) {
    clearTimeout(_backupTimer); performBackup();
  }
});

// ── 자동 복원 (캐시 손실 시 진입 시점에 호출) ──────────────────
//
// 호출 시점: 사용자가 패턴 입력 후 채팅 진입 시도 직전.
// 반환 값:
//   { action: 'enter',          ...상황별 부가 정보 }     → 채팅 진입 진행
//   { action: 'askCode' }                                  → 마이코드 입력 모달 (신규 또는 후보 N명)
//   { action: 'silent' }                                   → 조용히 무시 (비인가 사용자)
//
// 호출자는 enter면 진입, askCode면 모달, silent면 아무 동작 안 함.

async function tryAutoRestore(inputPattern) {
  // 캐시에 myCode가 살아있으면 자동 복원 흐름 불필요 (호출자가 결정)
  // 이 함수는 myCode 없을 때만 호출된다는 전제

  // 마스터 패턴(0125478)이면 → 그냥 진입.
  // enterChatApp이 myCode 없으면 chatSetup(코드 입력 화면)을 표시함.
  // 자동 복원 모달 없음.
  if (isMasterPattern(inputPattern)) {
    return { action: 'enter' };
  }

  // 마스터 아니면 → patternIndex 조회
  var hash = await patternToHash(inputPattern);
  if (!hash) return { action: 'silent' };

  try {
    var snap = await db.collection('patternIndex').doc(hash).get();
    if (!snap.exists) return { action: 'silent' };
    var codes = (snap.data() || {}).codes || [];
    if (!codes.length) return { action: 'silent' };

    if (codes.length === 1) {
      // 후보 단독 → 조용히 복원 시도
      var ok = await _restoreCode(codes[0], hash);
      if (ok) return { action: 'enter', restored: true };
      // backups 문서가 없거나 해시 불일치 (마이그레이션 미완료 케이스)
      // → users 문서 존재 여부로 합법 사용자 확인 후 진입 허용
      try {
        var userSnap = await db.collection('users').doc(codes[0]).get();
        if (userSnap.exists) {
          // users 문서에 myCode 복원 (데이터는 없지만 코드는 살아있음)
          localStorage.setItem('myCode', codes[0]);
          // 다음 진입 시 정상 백업되도록 즉시 백업 트리거
          setTimeout(function() { try { performBackup(); } catch(e){} }, 1000);
          return { action: 'enter', restored: true };
        }
      } catch(e) {}
      return { action: 'silent' };
    }
    // 후보 여러 명 → 코드 입력 모달
    return { action: 'askCode', source: 'multi', candidates: codes, hash: hash };
  } catch(e) {
    console.log('[RESTORE] index lookup error:', e.message);
    return { action: 'silent' };
  }
}

// 마이코드 입력 후 처리. 패턴은 이미 입력된 상태(savedPattern)
// source: 'master' = 마스터 패턴 흐름 (신규/복원 모두 허용)
//         'multi'  = 후보 여러 명 (후보 중에서만 복원, 없으면 거부)
// 반환:
//   { ok: true, mode: 'restored'|'new' }
//   { ok: false, error: 'duplicate'|'notFound' }
async function applyCodeAfterPattern(inputCode, source, candidates) {
  inputCode = (inputCode || '').trim().toUpperCase();
  if (!inputCode) return { ok: false, error: 'notFound' };

  var currentHash = await patternToHash(savedPattern);

  if (source === 'master') {
    // 신규 또는 같은 패턴(드물게 마스터+같은 코드)의 본인 복원
    try {
      var snap = await db.collection('backups').doc(inputCode).get();
      if (!snap.exists) {
        // 백업 없음 → 신규 사용자로 시작
        await _initNewUser(inputCode);
        return { ok: true, mode: 'new' };
      }
      // 백업 있음 → patternHash 비교
      var data = snap.data();
      if (data.patternHash === currentHash) {
        // 동일 패턴+동일 코드 → 본인. 복원 (드문 케이스)
        var ok = await _restoreCode(inputCode, currentHash);
        if (ok) return { ok: true, mode: 'restored' };
      }
      // 패턴 다른데 코드 중복 = 다른 사용자 → 거부
      return { ok: false, error: 'duplicate' };
    } catch(e) {
      return { ok: false, error: 'notFound' };
    }
  }

  // source === 'multi' : 후보 중에서만 매칭
  if (!candidates || candidates.indexOf(inputCode) < 0) {
    return { ok: false, error: 'notFound' };
  }
  var ok2 = await _restoreCode(inputCode, currentHash);
  return ok2 ? { ok: true, mode: 'restored' } : { ok: false, error: 'notFound' };
}

// 실제 복원: backups/{code}에서 payload 가져와 localStorage 적용
async function _restoreCode(code, expectedHash) {
  try {
    var snap = await db.collection('backups').doc(code).get();
    if (!snap.exists) return false;
    var data = snap.data() || {};
    // 패턴 해시 추가 검증 (불일치 시 거부)
    if (expectedHash && data.patternHash !== expectedHash) return false;
    var payload = data.payload || {};
    Object.keys(payload).forEach(function(k) {
      if (BACKUP_KEYS.indexOf(k) >= 0) {
        localStorage.setItem(k, payload[k]);
      }
    });
    localStorage.setItem('myCode', code);
    return true;
  } catch(e) {
    console.log('[RESTORE] _restoreCode error:', e.message);
    return false;
  }
}

// 신규 사용자 초기화: 입력한 코드로 시작
async function _initNewUser(code) {
  localStorage.setItem('myCode', code);
  localStorage.setItem('friends', '[]');
  try {
    await db.collection('users').doc(code).set({
      code: code, friends: [], ts: firebase.firestore.Timestamp.now()
    });
  } catch(e) { console.log('[NEW] user create error:', e.message); }
  // 첫 백업 트리거 (자기 코드를 patternIndex에 등록)
  try { await performBackup(); } catch(e) {}
}

// ── 마이코드 입력 모달 (restoreModal 재활용) ──
// 신규 사용자 / 후보 N명일 때 동일 모달 표시
var _pendingRestore = null;  // {source, candidates}

function showCodeInputModal(source, candidates) {
  _pendingRestore = { source: source, candidates: candidates || [] };
  var modal = document.getElementById('restoreModal');
  if (!modal) return;
  var input = document.getElementById('restoreCodeInput');
  if (input) input.value = '';
  var warn = document.getElementById('restoreWarn');
  if (warn) warn.style.display = 'none';
  modal.style.display = 'flex';
}

function closeRestoreModal() {
  var modal = document.getElementById('restoreModal');
  if (modal) modal.style.display = 'none';
  _pendingRestore = null;
}

async function performRestore() {
  var input = document.getElementById('restoreCodeInput');
  if (!input || !_pendingRestore) { closeRestoreModal(); return; }
  var code = input.value.trim().toUpperCase();
  if (!code) return;

  var ctx = _pendingRestore;
  closeRestoreModal();
  try { showUploadStatus(__T('Verifying...','확인 중...','正在确认...','確認中...')); } catch(e) {}
  var r = await applyCodeAfterPattern(code, ctx.source, ctx.candidates);
  try { hideUploadStatus(); } catch(e) {}

  var en = localStorage.getItem('lang') === 'en';
  if (r.ok) {
    // 성공: 페이지 새로고침으로 깔끔하게 시작
    setTimeout(function() { window.location.reload(); }, 200);
  } else {
    var msg;
    if (r.error === 'duplicate') {
      msg = __T('Code already in use','이미 등록된 코드입니다','此代码已被使用','既に登録されているコードです');
    } else {
      msg = __T('No matching code registered','등록된 코드가 없습니다','未找到该代码','登録されたコードがありません');
    }
    showAlert(msg);
  }
}

function listenFriendChanges() {
  if (!myCode) return;
  if (friendsListener) friendsListener();
  // 로컬 캐시로 즉시 렌더링 (깜박임 방지)
  var cached = localStorage.getItem('friends');
  if (cached) { try { friends = JSON.parse(cached); renderFriendList(); } catch(e){} }

  // 공유 요청/응답 리스너 동시 시작
  try { startShareRequestListener(); } catch(e) {}
  try { startShareResponseListener(); } catch(e) {}

  // 영속성 강화 권한 (조용히 시도, 실패해도 무해)
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function() {});
    }
  } catch(e) {}

  // 앱 시작 시 한 번 백업 수행 (마지막 백업 6시간 초과 시)
  try {
    var last = parseInt(localStorage.getItem('_lastBackup') || '0');
    if (Date.now() - last > 6 * 60 * 60 * 1000) {
      scheduleBackup();
    }
  } catch(e) {}

  friendsListener = db.collection('users').doc(myCode).onSnapshot(snap => {
    if (!snap.exists) return;
    var newFriends = snap.data().friends || [];
    // 서버에서 빈 배열이 오더라도 캐시가 있으면 무시 (일시적 오류 방어)
    if (newFriends.length === 0 && friends.length > 0 && snap.metadata.fromCache) return;

    // 친구 목록에서 사라진 코드들 찾기 (상대가 나를 삭제한 경우)
    var removed = friends.filter(function(f) { return newFriends.indexOf(f) < 0; });

    friends = newFriends;
    localStorage.setItem('friends', JSON.stringify(friends));

    // stale shareTarget 정리
    var st = localStorage.getItem('shareTarget');
    if (st && friends.indexOf(st) < 0) {
      localStorage.removeItem('shareTarget');
    }
    // 사라진 친구로부터 받았던 메모 제거
    if (removed.length) {
      try {
        var memos = JSON.parse(localStorage.getItem('memos') || '[]');
        var cleaned = memos.filter(function(m) { return removed.indexOf(m.from) < 0; });
        if (cleaned.length !== memos.length) {
          localStorage.setItem('memos', JSON.stringify(cleaned));
        }
      } catch(e) {}
    }

    renderFriendList();
  }, function(err) {
    console.warn('friendsListener error:', err);
    // 에러 시 캐시 유지
  });
}

async function deleteChat(friendCode) {
  var _dl = localStorage.getItem('lang') || 'ko';
  var _dm;
  if (_dl === 'en') _dm = 'Delete chat and friend ' + friendCode + '?';
  else if (_dl === 'zh') _dm = '删除与 ' + friendCode + ' 的聊天和好友?';
  else if (_dl === 'ja') _dm = friendCode + ' とのチャットと友達を削除しますか?';
  else _dm = friendCode + '와의 대화 및 친구를 삭제할까요?';
  showConfirm(_dm, function() { _doDeleteChat(friendCode); }); return;
}
async function _doDeleteChat(friendCode) {
  // 1. 대화내용 삭제
  const roomId = [myCode, friendCode].sort().join('_');
  const snap = await db.collection('rooms').doc(roomId).collection('messages').get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  // [d] 로컬 캐시도 정리
  _clearChatCache(roomId);
  // 2. 내 친구목록에서 상대 제거 (로컬 + Firestore)
  friends = friends.filter(f => f !== friendCode);
  localStorage.setItem('friends', JSON.stringify(friends));
  await db.collection('users').doc(myCode).update({ friends: firebase.firestore.FieldValue.arrayRemove(friendCode) }).catch(() => {});
  // 3. 상대 친구목록에서 나 제거 (Firestore)
  await db.collection('users').doc(friendCode).update({ friends: firebase.firestore.FieldValue.arrayRemove(myCode) }).catch(() => {});

  // 4. 삭제된 친구가 공유 대상이었으면 정리
  //    - setShareTarget(null)을 통해 Firestore 메모 문서를 비워 상대측에서도 회수 반영
  //    - 이 친구로부터 받았던 메모(from=friendCode)도 로컬에서 제거
  if (localStorage.getItem('shareTarget') === friendCode) {
    try { await setShareTarget(null); } catch(e) {}
  }
  try {
    var memos = JSON.parse(localStorage.getItem('memos') || '[]');
    var cleaned = memos.filter(function(m) { return m.from !== friendCode; });
    if (cleaned.length !== memos.length) {
      localStorage.setItem('memos', JSON.stringify(cleaned));
    }
  } catch(e) {}

  // 5. 양방향 공유 요청/응답 문서 정리 (stale 방지)
  try {
    await db.collection('shareRequests').doc(friendCode + '_' + myCode + '_req').delete().catch(function(){});
    await db.collection('shareRequests').doc(myCode + '_' + friendCode + '_req').delete().catch(function(){});
    await db.collection('shareRequests').doc(friendCode + '_' + myCode + '_resp').delete().catch(function(){});
    await db.collection('shareRequests').doc(myCode + '_' + friendCode + '_resp').delete().catch(function(){});
  } catch(e) {}

  renderFriendList();
  showAlert(__T('Chat and friends deleted','대화 및 친구가 삭제되었습니다','聊天和好友已删除','チャットと友達が削除されました'));
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
  if (!code) { showAlert(__T('Please enter a code','코드를 입력하세요','请输入代码','コードを入力してください')); return; }
  if (code === myCode) { showAlert(__T('You cannot add yourself','자신의 코드는 추가할 수 없습니다','不能添加自己的代码','自分のコードは追加できません')); return; }
  if (friends.includes(code)) { showAlert(__T('Already added','이미 추가된 친구입니다','已添加','既に追加された友達です')); return; }

  // 존재하는 사용자인지 확인
  const snap = await db.collection('users').doc(code).get();
  if (!snap.exists) {
    var _lang = localStorage.getItem('lang') || 'ko';
    var _msg;
    if (_lang === 'en') _msg = '"' + code + '" is not a registered user';
    else if (_lang === 'zh') _msg = '"' + code + '" 是未注册的用户';
    else if (_lang === 'ja') _msg = '"' + code + '" は登録されていないユーザーです';
    else _msg = '"' + code + '" 는 등록되지 않은 사용자예요';
    showAlert(_msg);
    return;
  }

  friends.push(code); localStorage.setItem('friends', JSON.stringify(friends));
  await db.collection('users').doc(myCode).set({ friends: firebase.firestore.FieldValue.arrayUnion(code) }, { merge: true });
  await db.collection('users').doc(code).set({ friends: firebase.firestore.FieldValue.arrayUnion(myCode) }, { merge: true });
  renderFriendList(); closeAddFriend();
  var _lang2 = localStorage.getItem('lang') || 'ko';
  var _addMsg;
  if (_lang2 === 'en') _addMsg = code + ' has been added';
  else if (_lang2 === 'zh') _addMsg = code + ' 已添加';
  else if (_lang2 === 'ja') _addMsg = code + ' を追加しました';
  else _addMsg = code + ' 추가되었습니다';
  showAlert(_addMsg);
}

function renderMyQr() {
  const wrap = document.getElementById('myQrCode'); wrap.innerHTML = '';
  document.getElementById('myCodeDisplay2').textContent = myCode;
  if (typeof QRCode !== 'undefined') new QRCode(wrap, { text: 'SECURECHAT:'+myCode, width: 180, height: 180 });
}

function startQrScanner() {
  const wrap = document.getElementById('qrScannerWrap'); wrap.innerHTML = '';
  if (typeof Html5Qrcode === 'undefined') {
    var _qlbl = localStorage.getItem('lang') || 'ko';
    var _qmsg;
    if (_qlbl === 'en') _qmsg = 'Please use direct code input.';
    else if (_qlbl === 'zh') _qmsg = '请直接输入代码。';
    else if (_qlbl === 'ja') _qmsg = 'コードの直接入力をご利用ください。';
    else _qmsg = '코드 직접 입력을 사용하세요.';
    wrap.innerHTML = '<p style="color:#64748b;font-size:13px;text-align:center;">' + _qmsg + '</p>';
    return;
  }
  qrScanner = new Html5Qrcode('qrScannerWrap');
  qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 200 }, decoded => {
    if (decoded.startsWith('SECURECHAT:')) {
      const code = decoded.replace('SECURECHAT:', '');
      stopQrScanner();
      friends.push(code); localStorage.setItem('friends', JSON.stringify(friends));
      db.collection('users').doc(myCode).set({ friends: firebase.firestore.FieldValue.arrayUnion(code) }, { merge: true });
      db.collection('users').doc(code).set({ friends: firebase.firestore.FieldValue.arrayUnion(myCode) }, { merge: true });
      renderFriendList(); closeAddFriend();
      var _ql = localStorage.getItem('lang') || 'ko';
      var _qm;
      if (_ql === 'en') _qm = code + ' has been added';
      else if (_ql === 'zh') _qm = code + ' 已添加';
      else if (_ql === 'ja') _qm = code + ' を追加しました';
      else _qm = code + ' 추가되었습니다';
      showAlert(_qm);
    }
  }, () => {}).catch(() => {
    var _cl = localStorage.getItem('lang') || 'ko';
    var _cm;
    if (_cl === 'en') _cm = '<p style="color:#64748b;font-size:13px;text-align:center;">Camera permission required</p>';
    else if (_cl === 'zh') _cm = '<p style="color:#334155;font-size:13px;text-align:center;">需要相机权限</p>';
    else if (_cl === 'ja') _cm = '<p style="color:#334155;font-size:13px;text-align:center;">カメラの権限が必要です</p>';
    else _cm = '<p style="color:#334155;font-size:13px;text-align:center;">카메라 권한이 필요합니다</p>';
    wrap.innerHTML = _cm;
  });
}

function stopQrScanner() { if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; } }

async function regenerateCode() {
  var en = localStorage.getItem('lang') === 'en';
  var msg = __T('Regenerating your code will permanently delete all chats, memos, todos, calendar, stats, and backup data from server. Continue?','코드 재생성 시 채팅/메모/할일/달력/통계/백업 모든 데이터가 서버에서 영구 삭제됩니다. 계속할까요?','重新生成代码将从服务器永久删除所有聊天/备忘/待办/日历/统计/备份数据。继续吗?','コード再生成時、チャット/メモ/タスク/カレンダー/統計/バックアップの全データがサーバーから永久に削除されます。続けますか?');
  showConfirm(msg, function() { _doRegenerateCode(); }); return;
}
// 코드 변경/재생성 시 서버에 남은 내 데이터 전부 삭제
// - 백업 문서
// - 내가 참여한 모든 채팅방 (rooms/{roomId}/messages 포함)
// - 모든 공유 데이터 sid 문서 (todos/calendars/stats/memos_shared)
// - 공유 요청/응답 문서
// - users/{oldCode} 문서
async function _purgeServerData(oldCode, oldFriends) {
  if (!oldCode) return;

  // 1) 백업 문서 삭제 (옛 위치 + 새 위치)
  try {
    await db.collection('users').doc(oldCode).collection('backup').doc('data').delete();
  } catch(e) {}
  try {
    await db.collection('backups').doc(oldCode).delete();
  } catch(e) {}
  // patternIndex에서 내 코드 제거 (현재 patternHash 기준)
  try {
    var hash = await patternToHash(savedPattern);
    if (hash) {
      await db.collection('patternIndex').doc(hash).set({
        codes: firebase.firestore.FieldValue.arrayRemove(oldCode)
      }, { merge: true });
    }
  } catch(e) {}

  // 2) 친구별 정리: 채팅방, 공유 sid, 공유 요청
  for (const f of oldFriends || []) {
    const roomId = [oldCode, f].sort().join('_');
    // 채팅 메시지 일괄 삭제 (500개씩 페이지네이션)
    try {
      while (true) {
        const snap = await db.collection('rooms').doc(roomId).collection('messages').limit(450).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < 450) break;
      }
    } catch(e) {}
    try { await db.collection('rooms').doc(roomId).delete(); } catch(e) {}

    // 공유 sid 문서들
    const memoSid = [oldCode, f].sort().join('_memo_');
    const todoSid = [oldCode, f].sort().join('_todo_');
    const calSid  = [oldCode, f].sort().join('_cal_');
    const statSid = [oldCode, f].sort().join('_stat_');
    try { await db.collection('memos_shared').doc(memoSid).delete(); } catch(e) {}
    try { await db.collection('todos').doc(todoSid).delete(); } catch(e) {}
    try { await db.collection('calendars').doc(calSid).delete(); } catch(e) {}
    try { await db.collection('stats').doc(statSid).delete(); } catch(e) {}

    // 공유 요청/응답 (양방향)
    try { await db.collection('shareRequests').doc(f + '_' + oldCode + '_req').delete(); } catch(e) {}
    try { await db.collection('shareRequests').doc(oldCode + '_' + f + '_req').delete(); } catch(e) {}
    try { await db.collection('shareRequests').doc(f + '_' + oldCode + '_resp').delete(); } catch(e) {}
    try { await db.collection('shareRequests').doc(oldCode + '_' + f + '_resp').delete(); } catch(e) {}

    // 친구의 users 문서에서 내 코드 제거
    try {
      await db.collection('users').doc(f).update({
        friends: firebase.firestore.FieldValue.arrayRemove(oldCode)
      });
    } catch(e) {}
  }

  // 3) 마지막으로 내 users 문서 삭제
  try { await db.collection('users').doc(oldCode).delete(); } catch(e) {}
}

// 로컬 데이터 전부 삭제 (코드 변경/재생성 시)
function _purgeLocalData() {
  // 진행 중 백업 타이머 취소 (oldCode로 백업되는 것 방지)
  if (typeof _backupTimer !== 'undefined' && _backupTimer) {
    clearTimeout(_backupTimer);
    _backupTimer = null;
  }
  // 친구 관계 끊겼으므로 모든 앱 데이터 제거 + 설정 일부 유지
  // 유지: 언어/테마/다크/아이콘/잠금패턴/타이틀 등 사용자 환경설정
  // 삭제: 친구, 공유타겟, 메모, 할일, 달력, 통계, 백업타임스탬프
  ['friends', 'shareTarget', 'memos', 'todos', 'habits', 'hStats', '_lastBackup']
    .forEach(function(k) { localStorage.removeItem(k); });
  // [d] 모든 채팅 캐시 제거
  try {
    var rm = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('chatCache_') === 0) rm.push(k);
    }
    rm.forEach(function(k){ localStorage.removeItem(k); });
  } catch(e) {}
}

async function _doRegenerateCode() {
  var oldCode = myCode;
  var oldFriends = friends.slice();
  try { showUploadStatus(__T('Deleting server data...','서버 데이터 삭제 중...','正在删除服务器数据...','サーバーデータを削除中...')); } catch(e) {}
  await _purgeServerData(oldCode, oldFriends);
  try { hideUploadStatus(); } catch(e) {}

  myCode = 'U' + Math.random().toString(36).substr(2,7).toUpperCase();
  friends = [];
  _purgeLocalData();
  localStorage.setItem('myCode', myCode);
  localStorage.setItem('friends', '[]');

  await db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() });
  renderMyQr(); renderFriendList(); showAlert(__T('Code regenerated: ','코드 재생성: ','代码已重新生成: ','コード再生成: ') + myCode);
}

// ── CHANGE CODE ─────────────────────────────────────
function openChangeCode() { document.getElementById('changeCodeModal').style.display = 'flex'; document.getElementById('newCodeInput').value = ''; }
function closeChangeCode() { document.getElementById('changeCodeModal').style.display = 'none'; }

async function confirmChangeCode() {
  const newCode = document.getElementById('newCodeInput').value.trim().toUpperCase();
  if (!newCode || newCode.length < 2) {
    showAlert(__T('At least 2 chars required','2자 이상 입력하세요','请输入至少2个字符','2文字以上入力してください'));
    return;
  }
  if (newCode === myCode) {
    showAlert(__T('Same as current code','현재 코드와 같습니다','与当前代码相同','現在のコードと同じです'));
    return;
  }
  closeChangeCode();
  // 두 번째 모달: 데이터 초기화 / 유지 / 취소
  openChangeCodeChoiceModal(newCode);
}

// 두 번째 확인 모달: 데이터 처리 방식 선택
function openChangeCodeChoiceModal(newCode) {
  var modal = document.getElementById('changeCodeChoiceModal');
  if (!modal) return;
  modal.dataset.newCode = newCode;
  modal.style.display = 'flex';
}
function closeChangeCodeChoiceModal() {
  var modal = document.getElementById('changeCodeChoiceModal');
  if (modal) modal.style.display = 'none';
}

// "데이터 초기화" 선택: 기존 모든 서버+로컬 데이터 삭제 후 새 코드로 신규 시작
async function changeCodeAndPurge() {
  var modal = document.getElementById('changeCodeChoiceModal');
  var newCode = modal ? modal.dataset.newCode : '';
  closeChangeCodeChoiceModal();
  if (!newCode) return;

  var oldCode = myCode;
  var oldFriends = friends.slice();
  try { showUploadStatus(__T('Deleting server data...','서버 데이터 삭제 중...','正在删除服务器数据...','サーバーデータを削除中...')); } catch(e) {}
  // 서버 풀 정리 (백업/패턴인덱스 포함)
  await _purgeServerData(oldCode, oldFriends);
  try {
    var oldHash = await patternToHash(savedPattern);
    if (oldHash && oldCode) {
      await db.collection('patternIndex').doc(oldHash).set({
        codes: firebase.firestore.FieldValue.arrayRemove(oldCode)
      }, { merge: true }).catch(function(){});
    }
    await db.collection('backups').doc(oldCode).delete().catch(function(){});
  } catch(e) {}
  try { hideUploadStatus(); } catch(e) {}

  myCode = newCode;
  friends = [];
  _purgeLocalData();
  localStorage.setItem('myCode', myCode);
  localStorage.setItem('friends', '[]');

  await db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() });
  // 새 백업 (patternIndex 자동 등록)
  try { await performBackup(); } catch(e) {}
  closeSecretSettings();
  renderFriendList();
  var _cL = localStorage.getItem('lang') || 'ko';
  var _cM;
  if (_cL === 'en') _cM = 'Code changed to: ' + myCode;
  else if (_cL === 'zh') _cM = '代码已更改为: ' + myCode;
  else if (_cL === 'ja') _cM = 'コードが変更されました: ' + myCode;
  else _cM = '코드가 변경되었습니다: ' + myCode;
  showAlert(_cM);
}

// "데이터 유지" 선택: 메모/할일/통계/달력/설정은 유지, 친구/채팅/공유만 정리
async function changeCodeAndKeep() {
  var modal = document.getElementById('changeCodeChoiceModal');
  var newCode = modal ? modal.dataset.newCode : '';
  closeChangeCodeChoiceModal();
  if (!newCode) return;

  var oldCode = myCode;
  var oldFriends = friends.slice();
  try { showUploadStatus(__T('Changing code...','코드 변경 중...','正在更改代码...','コード変更中...')); } catch(e) {}

  // 친구 관계 + 서버 양측 정리 (메모/할일/통계/달력 로컬은 유지)
  await _purgeServerData(oldCode, oldFriends);
  // 옛 백업 + 옛 patternIndex에서 oldCode 제거
  try {
    var hash = await patternToHash(savedPattern);
    if (hash && oldCode) {
      await db.collection('patternIndex').doc(hash).set({
        codes: firebase.firestore.FieldValue.arrayRemove(oldCode)
      }, { merge: true }).catch(function(){});
    }
    await db.collection('backups').doc(oldCode).delete().catch(function(){});
  } catch(e) {}

  // 로컬: 친구/공유 관련만 정리, 데이터는 유지
  localStorage.removeItem('friends');
  localStorage.removeItem('shareTarget');
  // 받은 메모(from 있는) 제거
  try {
    var memos = JSON.parse(localStorage.getItem('memos') || '[]');
    var cleaned = memos.filter(function(m) { return !m.from; });
    if (cleaned.length !== memos.length) localStorage.setItem('memos', JSON.stringify(cleaned));
  } catch(e) {}

  myCode = newCode;
  friends = [];
  localStorage.setItem('myCode', myCode);
  localStorage.setItem('friends', '[]');

  // 새 users 문서
  await db.collection('users').doc(myCode).set({ code: myCode, friends: [], ts: firebase.firestore.Timestamp.now() });
  // 새 백업 (새 myCode로 patternIndex 등록 + 데이터는 그대로)
  try { await performBackup(); } catch(e) {}
  try { hideUploadStatus(); } catch(e) {}
  closeSecretSettings();
  renderFriendList();
  var _cL = localStorage.getItem('lang') || 'ko';
  var _cM;
  if (_cL === 'en') _cM = 'Code changed to: ' + myCode;
  else if (_cL === 'zh') _cM = '代码已更改为: ' + myCode;
  else if (_cL === 'ja') _cM = 'コードが変更されました: ' + myCode;
  else _cM = '코드가 변경되었습니다: ' + myCode;
  showAlert(_cM);
}

// 기존 _doConfirmChangeCode는 폐기 (호환 위해 changeCodeAndPurge 호출하도록)
async function _doConfirmChangeCode(newCode) {
  // 구버전 호출 흔적이 있을 경우 안전 폴백
  var modal = document.getElementById('changeCodeChoiceModal');
  if (modal) modal.dataset.newCode = newCode;
  await changeCodeAndPurge();
}

// ── CHAT ────────────────────────────────────────────
// 키패드 올라올때 채팅 스크롤 유지
if (window.visualViewport) {
  function onViewportChange() {
    var chatView = document.getElementById('activeChatView');
    var list = document.getElementById('messageList');
    if (!chatView || !list) return;

    var vv = window.visualViewport;
    // 키패드 올라와도 top/height 정확히 맞춤
    chatView.style.top    = vv.offsetTop + 'px';
    chatView.style.height = vv.height + 'px';

    setTimeout(function() {
      var contentH = list.scrollHeight;
      var containerH = list.clientHeight;
      if (contentH <= containerH) {
        list.scrollTop = 0;
      } else {
        list.scrollTop = contentH - containerH;
      }
    }, 50);
  }
  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
}

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
  // [c] markMessagesRead는 listenMessages 첫 스냅샷 후 자동 호출됨
  // (진입 직후 호출하면 batch update가 즉시 onSnapshot을 재트리거하여 빈 화면 구간이 길어짐)
}

function backToFriendList() {
  // [d] 보류된 캐시 저장이 있으면 즉시 flush
  if (_cacheSaveTimer) { clearTimeout(_cacheSaveTimer); _cacheSaveTimer = null; }
  if (chatRoomId) _saveChatCache(chatRoomId);
  if (messageListener) { messageListener(); messageListener = null; }
  if (roomListener) { roomListener(); roomListener = null; }
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};
  activeFriendCode = null; chatRoomId = null;
  showFriendList();
}

var _lastHandledReqId = null;
var _lastHandledStatus = null;
var _roomListenStartTime = 0;

function listenRoomSettings() {
  if (!chatRoomId) return;
  _roomListenStartTime = Date.now();
  roomListener = db.collection('rooms').doc(chatRoomId).onSnapshot(snap => {
    if (!snap.exists) return;
    const data = snap.data();
    const req = data.deleteRequest;
    if (!req) return;

    var reqKey = req.id + '_' + req.status;
    if (reqKey === _lastHandledReqId) return; // 이미 처리한 상태 무시
    _lastHandledReqId = reqKey;

    if (req.from !== myCode && req.status === 'pending') {
      showDeleteTimeRequest(req.from, req.minutes, req.id);
    }
    if (req.status === 'rejected') {
      document.getElementById('deleteRequestBanner')?.remove();
      if (req.from === myCode && (req.updatedAt || 0) > _roomListenStartTime) {
        closeTimerModal();
        showAlert(__T('Partner rejected the change','상대방이 변경을 거부했습니다','对方拒绝了变更','相手が変更を拒否しました'));
      }
    }
    if (req.status === 'approved') {
      document.getElementById('deleteRequestBanner')?.remove();
      autoDeleteMinutes = req.minutes;
      localStorage.setItem('autoDeleteMin', autoDeleteMinutes);
      updateAutoDeleteLabel();
      // 요청 보낸 쪽: 상대가 승인하면 timerModal 자동 닫기
      closeTimerModal();
    }
  });
}

function showDeleteTimeRequest(from, minutes, reqId) {
  document.getElementById('deleteRequestBanner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'deleteRequestBanner'; banner.className = 'delete-request-banner';
  var _drL = localStorage.getItem('lang') || 'ko';
  var _drText, _drAccept, _drReject;
  if (_drL === 'en') {
    _drText = from + ' requested to change auto-delete time to <b>' + minutes + ' min</b>';
    _drAccept = 'Accept'; _drReject = 'Reject';
  } else if (_drL === 'zh') {
    _drText = from + ' 请求将自动删除时间更改为 <b>' + minutes + '分钟</b>';
    _drAccept = '同意'; _drReject = '拒绝';
  } else if (_drL === 'ja') {
    _drText = from + ' さんが自動削除時間を <b>' + minutes + '分</b> に変更リクエスト';
    _drAccept = '同意'; _drReject = '拒否';
  } else {
    _drText = from + '님이 자동삭제 시간을 <b>' + minutes + '분</b>으로 변경 요청';
    _drAccept = '동의'; _drReject = '거부';
  }
  banner.innerHTML = `<div class="drb-text">${_drText}</div>
    <div class="drb-btns">
      <button class="drb-accept" onclick="respondDeleteRequest(true,'${reqId}',${minutes})">${_drAccept}</button>
      <button class="drb-reject" onclick="respondDeleteRequest(false,'${reqId}',${minutes})">${_drReject}</button>
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
    await db.collection('rooms').doc(chatRoomId).update({ 'deleteRequest.status': 'rejected', 'deleteRequest.updatedAt': Date.now() });
  }
}

let seenMsgIds = new Set();
let firstLoad = true;

// ── 채팅 캐시 (오프라인/재진입 즉시 표시용) ────────────────────
// localStorage에 채팅방별로 최근 메시지를 저장. Firestore 첫 스냅샷이 오기 전
// 화면이 비어있는 구간을 제거하기 위함. 첫 스냅샷 도착 시 캐시와 서버 상태가
// 차이가 있으면 서버 기준으로 정리(서버 없는 메시지 제거).
const CHAT_CACHE_LIMIT = 200; // 방당 최대 메시지 수
function _chatCacheKey(roomId) { return 'chatCache_' + roomId; }
// Firestore Timestamp 호환 래퍼 (toDate/toMillis 지원)
function _ts(ms) { return { toDate: function(){ return new Date(ms); }, toMillis: function(){ return ms; } }; }
function _loadChatCache(roomId) {
  try {
    var raw = localStorage.getItem(_chatCacheKey(roomId));
    if (!raw) return [];
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 직렬화된 ts/deleteAt(ms) → Timestamp 호환 객체로 복원
    return arr.map(function(item) {
      var d = item.data || {};
      var restored = Object.assign({}, d);
      if (typeof d._tsMs === 'number') restored.ts = _ts(d._tsMs);
      if (typeof d._deleteAtMs === 'number') restored.deleteAt = _ts(d._deleteAtMs);
      else if (d._deleteAtMs === null) restored.deleteAt = null;
      return { id: item.id, data: restored };
    });
  } catch(e) { return []; }
}
function _saveChatCache(roomId) {
  try {
    var list = document.getElementById('messageList');
    if (!list || !_cachedMessages) return;
    // _cachedMessages는 listenMessages가 관리하는 메모리 캐시 (id -> data)
    var ids = Array.from(list.children).map(function(el){ return (el.id||'').replace(/^msg-/,''); });
    var out = [];
    ids.forEach(function(id) {
      if (!id) return;
      var d = _cachedMessages[id];
      if (!d) return;
      var ser = Object.assign({}, d);
      // Timestamp는 직렬화 불가 → ms 숫자로 변환
      if (d.ts && typeof d.ts.toMillis === 'function') { ser._tsMs = d.ts.toMillis(); delete ser.ts; }
      if (d.deleteAt && typeof d.deleteAt.toMillis === 'function') { ser._deleteAtMs = d.deleteAt.toMillis(); delete ser.deleteAt; }
      else if (d.deleteAt === null) { ser._deleteAtMs = null; delete ser.deleteAt; }
      out.push({ id: id, data: ser });
    });
    // 상한 적용 (최근 메시지 우선)
    if (out.length > CHAT_CACHE_LIMIT) out = out.slice(out.length - CHAT_CACHE_LIMIT);
    localStorage.setItem(_chatCacheKey(roomId), JSON.stringify(out));
  } catch(e) {}
}
function _clearChatCache(roomId) {
  try { localStorage.removeItem(_chatCacheKey(roomId)); } catch(e) {}
}
// 메모리 캐시 (현재 방의 id → data). 직렬화 시 사용.
var _cachedMessages = null;
// 캐시 저장 debounce 타이머
var _cacheSaveTimer = null;
function _scheduleCacheSave() {
  if (_cacheSaveTimer) clearTimeout(_cacheSaveTimer);
  var roomId = chatRoomId;
  _cacheSaveTimer = setTimeout(function() { _saveChatCache(roomId); }, 500);
}

function listenMessages() {
  // 기존 리스너 완전 정리
  if (messageListener) { messageListener(); messageListener = null; }
  Object.values(deleteTimers).forEach(t => clearTimeout(t)); deleteTimers = {};
  Object.values(countdownTimers).forEach(t => clearInterval(t)); countdownTimers = {};

  seenMsgIds = new Set();
  firstLoad = true;
  _cachedMessages = {};

  // 채팅방 진입 시 이전 잔여 DOM 깨끗히 정리 (이전 방의 메시지가 남아있을 수 있음)
  var initList = document.getElementById('messageList');
  if (initList) initList.innerHTML = '';

  // [d] 캐시된 메시지를 즉시 표시 → 첫 스냅샷 도착 전 빈 화면 제거
  var cached = _loadChatCache(chatRoomId);
  if (cached.length && initList) {
    cached.forEach(function(item) {
      _cachedMessages[item.id] = item.data;
      seenMsgIds.add(item.id);
      renderMessage(item.data, item.id);
      // 캐시된 메시지가 이미 deleteAt이 있으면 자동삭제 타이머도 복원
      if (item.data.deleteAt) scheduleAutoDelete(item.id, item.data);
    });
    initList.scrollTop = initList.scrollHeight;
  }

  messageListener = db.collection('rooms').doc(chatRoomId).collection('messages').orderBy('ts')
    .onSnapshot(snap => {
      const list = document.getElementById('messageList');
      if (!list) return;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;

      let hasNewMsg = false;
      let myNewMsg = false;
      const changes = snap.docChanges();

      // 첫 스냅샷이면 서버에 있는 ID 집합을 만들어두고, 캐시로 그려놨지만
      // 서버에 없는(이미 삭제된) 메시지 노드를 제거한다.
      if (firstLoad) {
        var serverIds = new Set();
        snap.docs.forEach(function(d){ serverIds.add(d.id); });
        // 캐시로 그려둔 노드 중 서버에 없는 것 제거
        Array.from(list.children).forEach(function(el){
          var nid = (el.id || '').replace(/^msg-/, '');
          if (nid && !serverIds.has(nid)) {
            el.remove();
            if (deleteTimers[nid]) { clearTimeout(deleteTimers[nid]); delete deleteTimers[nid]; }
            if (countdownTimers[nid]) { clearInterval(countdownTimers[nid]); delete countdownTimers[nid]; }
            seenMsgIds.delete(nid);
            delete _cachedMessages[nid];
          }
        });
      }

      changes.forEach(change => {
        const id = change.doc.id;
        const data = change.doc.data();

        if (change.type === 'added') {
          // 새 메시지 알림 처리 (첫 로드 이후, 상대방 메시지만)
          if (!firstLoad && data.sender !== myCode && data.type !== 'system' && !seenMsgIds.has(id)) {
            hasNewMsg = true;
            // FCM 토큰 없을 때만 SW 로컬 알림 (FCM 있으면 FCM이 알림 처리)
            if (document.visibilityState !== 'visible' && notifEnabled && Notification.permission === 'granted' && !fcmToken) {
              sendNotification(__T('New message','새 메시지','新消息','新着メッセージ'), __T('New notification','새 알림이 있어요','有新通知','新着通知があります'));
              unreadCount++;
              setBadge(unreadCount);
            }
          }
          // 내가 보낸 새 메시지면 스크롤 강제 보장
          if (!firstLoad && data.sender === myCode && !seenMsgIds.has(id)) {
            myNewMsg = true;
          }
          seenMsgIds.add(id);
          _cachedMessages[id] = data;

          // 이미 DOM에 있으면 중복 추가 방지 (캐시로 미리 그려진 경우 포함)
          if (document.getElementById('msg-' + id)) {
            // 데이터만 갱신 (modified로 들어오지 않은 케이스 대비)
            if (!deleteTimers[id]) scheduleAutoDelete(id, data);
            startCountdown(id, data.deleteAt);
            return;
          }

          // newIndex 위치에 정확히 삽입
          // (newIndex는 정렬된 결과 기준 인덱스. 동등 정렬을 위해 list.children에 매핑)
          const children = list.children;
          const beforeNode = (change.newIndex >= 0 && change.newIndex < children.length)
            ? children[change.newIndex] : null;
          renderMessage(data, id, beforeNode);
          if (!deleteTimers[id]) scheduleAutoDelete(id, data);
        }
        else if (change.type === 'modified') {
          // 카운트다운/자동삭제 타이머만 갱신 (메시지 내용은 immutable)
          if (deleteTimers[id]) { clearTimeout(deleteTimers[id]); delete deleteTimers[id]; }
          scheduleAutoDelete(id, data);
          startCountdown(id, data.deleteAt);
          _cachedMessages[id] = data;
        }
        else if (change.type === 'removed') {
          // 해당 노드만 제거 + 타이머 정리
          const node = document.getElementById('msg-' + id);
          if (node) node.remove();
          if (deleteTimers[id]) { clearTimeout(deleteTimers[id]); delete deleteTimers[id]; }
          if (countdownTimers[id]) { clearInterval(countdownTimers[id]); delete countdownTimers[id]; }
          seenMsgIds.delete(id);
          delete _cachedMessages[id];
        }
      });

      // 채팅창 열려있는 상태에서 새 메시지 오면 즉시 읽음 처리 → 카운트 시작
      if (hasNewMsg) markMessagesRead();

      // 첫 로드, 내 메시지, 또는 이미 맨 아래에 있던 경우 → 맨 아래로 스크롤
      if (firstLoad || myNewMsg || atBottom) list.scrollTop = list.scrollHeight;

      // [c] 첫 스냅샷이 그려진 다음에야 읽음 처리(batch update)를 호출
      // → 진입 직후 빈 화면 구간 제거, modified 이벤트는 (a) 증분 렌더에서 본문 재렌더 안 함
      if (firstLoad) {
        markMessagesRead();
      }

      firstLoad = false;

      // [d] 캐시 저장 (debounce로 부담 최소화)
      _scheduleCacheSave();
    });
}

function renderMessage(data, id, beforeNode) {
  const list = document.getElementById('messageList');
  const mine = data.sender === myCode;
  if (data.type === 'system') {
    const sysDiv = document.createElement('div');
    sysDiv.className = 'msg-bubble system-msg';
    sysDiv.id = 'msg-' + id;
    sysDiv.textContent = data.text;
    if (beforeNode) list.insertBefore(sysDiv, beforeNode);
    else list.appendChild(sysDiv);
    return;
  }

  // 컨테이너 (시간 + 말풍선 가로 배치)
  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'msg-row-mine' : 'msg-row-theirs'}`;
  row.id = 'msg-' + id;

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
  sent.textContent = d.toLocaleTimeString(_locForLang(localStorage.getItem('lang')||'ko'), { hour: '2-digit', minute: '2-digit' });
  const cd = document.createElement('div'); cd.className = 'msg-countdown'; cd.id = 'cd-' + id;
  meta.appendChild(sent); meta.appendChild(cd);

  // 내 메시지: 시간 - 말풍선 / 상대 메시지: 말풍선 - 시간
  if (mine) { row.appendChild(meta); row.appendChild(bubble); }
  else { row.appendChild(bubble); row.appendChild(meta); }

  if (beforeNode) list.insertBefore(row, beforeNode);
  else list.appendChild(row);
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
  if (!currentUser) { showAlert(__T('Auth failed - refresh and retry','인증 실패 - 새로고침 후 다시 시도하세요','认证失败 - 请刷新后重试','認証失敗 - 更新後再試行してください')); return; }

  // 단일 파일
  if (files.length === 1) {
    const file = files[0];
    const isVideo = file.type.startsWith('video');
    const isImage = file.type.startsWith('image');
    if (!isVideo && !isImage) { showAlert(__T('Only images or videos can be sent','이미지 또는 영상만 전송 가능합니다','只能发送图片或视频','画像または動画のみ送信可能です')); return; }
    showUploadStatus(__T('Uploading...','업로드 중...','正在上传...','アップロード中...'));
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
    } catch(err) { hideUploadStatus(); showAlert(__T('Send failed: ','전송 실패: ','发送失败: ','送信失敗: ') + err.message); }
    return;
  }

  // 다중 파일 - 앨범으로 묶어서 전송
  const imageFiles = files.filter(f => f.type.startsWith('image'));
  if (!imageFiles.length) { showAlert(__T('Only images can be sent as a bundle','이미지만 묶음 전송 가능합니다','只能批量发送图片','画像のみ一括送信可能です')); return; }
  if (imageFiles.length > 10) { showAlert(__T('Up to 10 photos can be selected','최대 10장까지 선택 가능합니다','最多可选择10张','最大10枚まで選択可能です')); return; }

  showUploadStatus(__T('Uploading...','업로드 중...','正在上传...','アップロード中...') + ` (0/${imageFiles.length})`);
  try {
    const urls = [];
    const paths = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const path = `media/${chatRoomId}/${Date.now()}_${i}`;
      const snap = await storage.ref().child(path).put(imageFiles[i]);
      urls.push(await snap.ref.getDownloadURL());
      paths.push(path);
      showUploadStatus(__T('Uploading...','업로드 중...','正在上传...','アップロード中...') + ` (${i+1}/${imageFiles.length})`);
    }
    await db.collection('rooms').doc(chatRoomId).collection('messages').add({
      sender: myCode, receiverId: activeFriendCode,
      type: 'album', urls, storagePaths: paths,
      ts: firebase.firestore.Timestamp.now(), deleteAt: null
    });
    hideUploadStatus();
    const friendSnap = await db.collection('users').doc(activeFriendCode).get();
    if (friendSnap.exists && friendSnap.data().fcmToken) sendFCMPush(friendSnap.data().fcmToken);
  } catch(err) { hideUploadStatus(); showAlert(__T('Send failed: ','전송 실패: ','发送失败: ','送信失敗: ') + err.message); }
}

async function sendMessage() {
  const input = document.getElementById('msgInput'); const text = input.value.trim();
  if (!text || !chatRoomId) return;
  input.value = '';
  // textarea 높이 초기화
  input.style.height = 'auto';
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
      sendFCMPush(friendSnap.data().fcmToken, __T('New message','새 메시지','新消息','新着メッセージ'), __T('New notification','새 알림이 있어요','有新通知','新着通知があります'));
    }
  } catch(e) { console.log('push error:', e.message); }
}

async function deleteAllNow() {
  if (!chatRoomId) return;
  showConfirm(__T('All chats will be deleted immediately. Cannot be recovered.','모든 채팅을 즉시 삭제합니다. 복구 불가입니다.','将立即删除所有聊天。无法恢复。','全てのチャットを即座に削除します。復元不可です。'), function() { _doDeleteAllNow(); }); return;
}
async function _doDeleteAllNow() {
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
  // [d] 캐시 즉시 정리 (onSnapshot에서도 정리되지만 명시적으로)
  _cachedMessages = {};
  if (chatRoomId) _clearChatCache(chatRoomId);
}

function openTimerSetting() { document.getElementById('timerModal').style.display = 'flex'; }
function closeTimerModal() {
  document.getElementById('timerModal').style.display = 'none';
  _resetTimerModal();
}

function _resetTimerModal() {
  var opts = document.getElementById('timerOptions');
  var actionBtn = document.getElementById('deleteNowBtn');
  var closeBtn = document.getElementById('closeTimerBtn');
  var desc = document.getElementById('timerModalDesc');
  var en = localStorage.getItem('lang') === 'en';

  if (opts) {
    opts.style.display = 'grid';
    opts.querySelectorAll('.timer-opt').forEach(function(b) {
      b.classList.remove('timer-opt-selected');
    });
  }
  // 하단 버튼 → Delete Now (빨간색)
  if (actionBtn) {
    actionBtn.style.display = '';
    actionBtn.textContent = __T('Delete Now','즉시삭제','立即删除','今すぐ削除');
    actionBtn.className = 'timer-action-btn timer-action-delete';
    actionBtn.setAttribute('onclick', 'closeTimerModal();deleteAllNow()');
  }
  // Cancel 복원
  if (closeBtn) {
    closeBtn.textContent = __T('Cancel','취소','取消','キャンセル');
    closeBtn.className = 'timer-cancel-btn';
    closeBtn.setAttribute('onclick', 'closeTimerModal()');
  }
  if (desc) {
    desc.textContent = __T('Requires partner approval to change','변경 시 상대방 동의가 필요합니다','变更需对方同意','変更には相手の同意が必要です');
    desc.style.color = '#334155'; desc.style.fontSize = '12px';
  }
  window._selectedTimerMin = null;
}

// 시간 버튼 클릭 → 선택 하이라이트 + 하단 버튼 Delete Now → Submit 교체
function selectTimerOpt(btn, min) {
  var opts = document.getElementById('timerOptions');
  if (opts) {
    opts.querySelectorAll('.timer-opt').forEach(function(b) {
      b.classList.remove('timer-opt-selected');
    });
  }
  btn.classList.add('timer-opt-selected');
  window._selectedTimerMin = min;

  // 하단 버튼 → Submit (primary 밝은색)
  var actionBtn = document.getElementById('deleteNowBtn');
  var en = localStorage.getItem('lang') === 'en';
  if (actionBtn) {
    actionBtn.textContent = __T('Submit','확인','提交','送信');
    actionBtn.className = 'timer-action-btn timer-action-submit';
    actionBtn.setAttribute('onclick', 'submitTimerSelection()');
  }
}

// Submit 클릭 → 실제 전송
async function submitTimerSelection() {
  var min = window._selectedTimerMin;
  if (!min) return;
  await setAutoDelete(min);
}

async function setAutoDelete(min) {
  if (!chatRoomId) {
    autoDeleteMinutes = min; localStorage.setItem('autoDeleteMin', min); updateAutoDeleteLabel();
    closeTimerModal(); return;
  }
  // 승인 대기 상태로 전환
  var opts = document.getElementById('timerOptions');
  var actionBtn = document.getElementById('deleteNowBtn');
  var closeBtn = document.getElementById('closeTimerBtn');
  var desc = document.getElementById('timerModalDesc');
  var en = localStorage.getItem('lang') === 'en';

  if (opts) opts.style.display = 'none';
  if (actionBtn) actionBtn.style.display = 'none';
  if (desc) { desc.textContent = __T('Waiting for partner approval...','상대방 승인 대기 중...','等待对方批准...','相手の承認待ち...'); desc.style.color = 'var(--primary)'; desc.style.fontSize = '14px'; }
  if (closeBtn) {
    closeBtn.textContent = __T('Close','닫기','关闭','閉じる');
    closeBtn.className = 'timer-close-pending-btn';
    closeBtn.setAttribute('onclick', 'closeTimerModal()');
  }

  const reqId = Date.now().toString();
  await db.collection('rooms').doc(chatRoomId).set({
    deleteRequest: { from: myCode, minutes: min, id: reqId, status: 'pending', appliedTo: [], ts: firebase.firestore.Timestamp.now() }
  }, { merge: true });
}
function updateAutoDeleteLabel() {
  var _adL = localStorage.getItem('lang') || 'ko';
  var _adT;
  if (_adL === 'en') _adT = 'Auto-delete: ' + autoDeleteMinutes + ' min';
  else if (_adL === 'zh') _adT = '自动删除: ' + autoDeleteMinutes + '分钟';
  else if (_adL === 'ja') _adT = '自動削除: ' + autoDeleteMinutes + '分';
  else _adT = '자동삭제: ' + autoDeleteMinutes + '분';
  document.getElementById('autoDeleteLabel').textContent = _adT;
}

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
  if(d) { d.classList.toggle('theme-active', theme === 'dark'); d.textContent = __T('Dark','다크','深色','ダーク'); }
  if(l) { l.classList.toggle('theme-active', theme === 'light'); l.textContent = __T('Light','라이트','浅色','ライト'); }
}

function updateFontSizeBtns() {
  const size = parseInt(localStorage.getItem('chatFontSize') || '18');
  const en = localStorage.getItem('lang') === 'en';
  const map = { 'fontSmBtn': 14, 'fontMdBtn': 18, 'fontLgBtn': 22 };
  const labels = { 'fontSmBtn': __T('S','소','小','小'), 'fontMdBtn': __T('M','중','中','中'), 'fontLgBtn': __T('L','대','大','大') };
  Object.entries(map).forEach(([id, s]) => {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('font-active', s === size); el.textContent = labels[id]; }
  });
  var sl = document.getElementById('fontSmLabel'); if(sl) sl.textContent = __T('S','소','小','小');
  var ml = document.getElementById('fontMdLabel'); if(ml) ml.textContent = __T('M','중','中','中');
  var ll = document.getElementById('fontLgLabel'); if(ll) ll.textContent = __T('L','대','大','大');
}

function toggleAutoLock(enabled) {
  localStorage.setItem('autoLock', enabled ? 'true' : 'false');
}
function toggleAutoLockBtn(btn) {
  var isOn = btn.dataset.on !== 'true';
  var en = localStorage.getItem('lang') === 'en';
  btn.dataset.on = isOn ? 'true' : 'false';
  btn.textContent = isOn ? (__T('On','켜짐','开','オン')) : (__T('Off','꺼짐','关','オフ'));
  btn.classList.toggle('ss-onoff-on', isOn);
  localStorage.setItem('autoLock', isOn ? 'true' : 'false');
}

function openSecretSettings() {
  initTitleInputs();
  document.getElementById('myCodeDisplaySettings').textContent = myCode;
  updateFontSizeBtns();
  updateThemeBtns();
  updateShareTargetDisplay();
  var autoLockEl = document.getElementById('autoLockToggle');
  if (autoLockEl) {
    var isOn = localStorage.getItem('autoLock') !== 'false';
    var en = localStorage.getItem('lang') === 'en';
    autoLockEl.dataset.on = isOn ? 'true' : 'false';
    autoLockEl.textContent = isOn ? (__T('On','켜짐','开','オン')) : (__T('Off','꺼짐','关','オフ'));
    autoLockEl.classList.toggle('ss-onoff-on', isOn);
  }
  document.getElementById('secretSettingsModal').style.display = 'flex';
}
function closeSecretSettings() { document.getElementById('secretSettingsModal').style.display = 'none'; }

// 공유 대상 현재값 표시
function updateShareTargetDisplay() {
  var el = document.getElementById('shareTargetCurrent');
  if (!el) return;
  var t = localStorage.getItem('shareTarget');
  el.textContent = t || '—';
}

// 공유 대상 선택 모달 열기
function openShareTargetPicker() {
  var listEl = document.getElementById('shareTargetList');
  var friends = JSON.parse(localStorage.getItem('friends') || '[]');
  var current = localStorage.getItem('shareTarget');
  var en = localStorage.getItem('lang') === 'en';

  if (!friends.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--chat-text2);font-size:13px;">' +
      (__T('No friends yet. Add a friend first.','친구가 없습니다. 먼저 친구를 추가하세요.','暂无好友。请先添加好友。','友達がいません。まず友達を追加してください。')) + '</div>';
  } else {
    listEl.innerHTML = friends.map(function(code) {
      var isCurrent = code === current;
      return '<button class="ss-btn ' + (isCurrent ? 'ss-btn-primary' : '') + '" ' +
             'style="padding:12px 14px;text-align:left;font-size:14px;font-weight:600;border-radius:10px;' +
             'display:flex;align-items:center;width:100%;' +
             (isCurrent ? '' : 'background:var(--chat-bg2);color:var(--chat-text);') + '" ' +
             'onclick="pickShareTarget(\'' + esc(code) + '\')">' +
             esc(code) + (isCurrent ? ' ✓' : '') + '</button>';
    }).join('');
  }
  document.getElementById('shareTargetModal').style.display = 'flex';
}

function closeShareTargetPicker() {
  document.getElementById('shareTargetModal').style.display = 'none';
}

// 친구 선택 시 호출
async function pickShareTarget(code) {
  closeShareTargetPicker();
  try { showUploadStatus(__T('Changing share target...','공유 대상 변경 중...','正在更改共享对象...','共有相手を変更中...')); } catch(e) {}
  try {
    await setShareTarget(code);
  } catch(e) { console.log('[SHARE] set error:', e.message); }
  try { hideUploadStatus(); } catch(e) {}
  updateShareTargetDisplay();
}

// 공유 대상 해제
async function clearShareTarget() {
  closeShareTargetPicker();
  try { showUploadStatus(__T('Releasing share target...','공유 대상 해제 중...','正在解除共享对象...','共有相手を解除中...')); } catch(e) {}
  try {
    await setShareTarget(null);
  } catch(e) { console.log('[SHARE] clear error:', e.message); }
  try { hideUploadStatus(); } catch(e) {}
  updateShareTargetDisplay();
}

// ── NOTIFICATIONS (in-app only) ─────────────────────
// notifEnabled = 채팅(이벤트) 알림 마스터. 새 키 notifEvent와 동기 유지.
let notifEnabled = (localStorage.getItem('notifEvent') === 'true') ||
                   (localStorage.getItem('notifEnabled') === 'true');
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
      // getToken이 내부적으로 권한 요청 다이얼로그를 띄울 수 있음 → 메인 튕김 방지 플래그
      _filePickerOpen = true;
      _appWasHidden = false;
      const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: sw });
      setTimeout(function() {
        _filePickerOpen = false;
        _appWasHidden = false;
      }, 1500);
      if (token) {
        fcmToken = token;
        localStorage.setItem('fcmToken', token);
        if (myCode) await db.collection('users').doc(myCode).set({ fcmToken: token }, { merge: true });
        console.log('FCM token saved');
      }
    } else {
      console.log('FCM not supported, using SW notifications only');
    }
  } catch(e) {
    _filePickerOpen = false;
    console.log('FCM init error:', e.message);
  }
}

// Render 서버로 FCM 푸시 전송
async function sendFCMPush(targetToken, title, body) {
  if (title == null) title = __T('New message','새 메시지','新消息','新着メッセージ');
  if (body == null) body = __T('New notification','새 알림이 있어요','有新通知','新着通知があります');
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
function toggleSettingsNotif(type, enabled) {
  var key = 'notif' + type.charAt(0).toUpperCase() + type.slice(1);
  localStorage.setItem(key, enabled ? 'true' : 'false');
  // 'event' = 채팅(이벤트) 알림 마스터 → 채팅 코드가 참조하는 notifEnabled와 동기화
  if (type === 'event') {
    notifEnabled = enabled;
    localStorage.setItem('notifEnabled', enabled ? 'true' : 'false');
  }
  // 'app' = 일반 앱 알림 마스터. 채팅 알림과 무관.
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

function showAlert(msg) {
  var overlay = document.getElementById('customAlertOverlay');
  var isEn = localStorage.getItem('lang') === 'en';
  document.getElementById('customAlertMsg').textContent = msg;
  var okBtn = document.getElementById('customAlertOk');
  okBtn.textContent = __T('OK','확인','确定','OK');
  overlay.style.display = 'flex';
  okBtn.onclick = function() { overlay.style.display = 'none'; okBtn.onclick = null; };
}

function showConfirm(msg, onOk, onCancel) {
  var overlay = document.getElementById('customConfirmOverlay');
  var isEn = localStorage.getItem('lang') === 'en';
  document.getElementById('customConfirmMsg').textContent = msg;
  var okBtn = document.getElementById('customConfirmOk');
  var cancelBtn = document.getElementById('customConfirmCancel');
  okBtn.textContent = __T('OK','확인','确定','OK');
  cancelBtn.textContent = __T('Cancel','취소','取消','キャンセル');
  overlay.style.display = 'flex';
  function cleanup() { overlay.style.display = 'none'; okBtn.onclick = null; cancelBtn.onclick = null; }
  okBtn.onclick = function() { cleanup(); if (onOk) onOk(); };
  cancelBtn.onclick = function() { cleanup(); if (onCancel) onCancel(); };
}




function openNaverMap() {
  window.open('https://map.naver.com', '_blank');
}



// -- Health Stats --
var STAT_CATS = {
  weight:   { label: "체중",   labelEn: "Weight",   labelZh: "体重",     labelJa: "体重",   unit: "kg",    color: "#4A90D9", emoji: "⚖️",
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v4l3 3"/></svg>' },
  bp:       { label: "혈압",   labelEn: "BP",       labelZh: "血压",     labelJa: "血圧",   unit: "mmHg",  color: "#ef4444", emoji: "🫀",
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
  steps:    { label: "걸음수", labelEn: "Steps",    labelZh: "步数",     labelJa: "歩数",   unit: "steps", color: "#22c55e", emoji: "🚶",
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v6l3 4"/><path d="M9 17l-2 4"/><path d="M15 13l2 4"/></svg>' },
  exercise: { label: "운동",   labelEn: "Exercise", labelZh: "运动",     labelJa: "運動",   unit: "min",   color: "#f59e0b", emoji: "🏃",
    svg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M15 8l-3 3-3-3"/><path d="M9 11l-3 6"/><path d="M15 11l3 6"/><path d="M9 17l3-4 3 4"/></svg>' }
};

function statLabel(k) {
  var lang = localStorage.getItem('lang') || 'ko';
  var c = STAT_CATS[k]; if (!c) return k;
  if (lang === 'en') return c.labelEn || c.label;
  if (lang === 'zh') return c.labelZh || c.labelEn || c.label;
  if (lang === 'ja') return c.labelJa || c.labelEn || c.label;
  return c.label;
}
function statUnit(k) {
  var lang = localStorage.getItem('lang') || 'ko';
  var u = STAT_CATS[k] && STAT_CATS[k].unit;
  if (!u) return '';
  if (lang === 'ko') return u;
  // ko 외 언어에서는 영문 단위 매핑 (간단)
  var unitMap = { '보': 'steps', '분': 'min' };
  return unitMap[u] || u;
}
var curSC = "weight";

function getSharedStatId() {
  if (!myCode) return null;
  var target = getShareTarget();
  if (!target) return null;
  return [myCode, target].sort().join('_stat_');
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
  document.getElementById("featureTitle").textContent = __T("Health Stats","건강 통계","健康统计","健康統計");
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
          if (localStorage.getItem('notifApp') === 'true') sendNotification(__T('Stats','통계','统计','統計'), __T('Health record updated','건강 기록이 업데이트됐어요','健康记录已更新','健康記録が更新されました'));
        }
        firstLoad = false;
        renderStatsUI();
      }
    });
  }
  renderStatsUI();
  showScreen("planFeature");
}

function renderStatsUI() {
  var fc = document.getElementById("featureContent");
  var data = getSD();
  var cat = STAT_CATS[curSC];
  var entries = (data[curSC]||[]).slice().sort(function(a,b){return a.date>b.date?1:-1;});
  var isDark = document.body.classList.contains('dark-mode');
  var boxBg   = isDark ? '#1A1A1A' : '#F8F9FF';
  var boxBd   = isDark ? '#2A2A2A' : '#ECEEF8';
  var titleCl = isDark ? '#F1F1F1' : '#1e293b';
  var dateCl  = isDark ? '#334155' : '#334155';

  var tabHtml = '<div style="display:flex;flex-wrap:nowrap;gap:8px;padding:4px 0 16px;overflow-x:auto;">';
  Object.keys(STAT_CATS).forEach(function(k) {
    var c = STAT_CATS[k];
    var active = (k === curSC);
    var hasDot = data[k] && data[k].length > 0;
    var bg = active ? "var(--primary)" : "var(--card,#f1f5f9)";
    var col = active ? "#fff" : "var(--text,#334155)";
    var btn = document.createElement("button");
    btn.innerHTML = statLabel(k) + (hasDot ? " ●" : "");
    btn.setAttribute("data-scat", k);
    btn.style.cssText = "width:72px;padding:6px 0;border-radius:20px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:" + bg + ";color:" + col + ";text-align:center;flex-shrink:0;";
    tabHtml += btn.outerHTML;
  });
  tabHtml += "</div>";

  var addHtml = '<div style="text-align:right;margin-bottom:12px;"><button id="openSmBtn" style="background:var(--primary);color:#fff;border:none;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;">' + (__T('+ Add','+ 입력','+ 添加','+ 入力')) + '</button></div>';

  var chartHtml = '<div style="background:' + boxBg + ';border:1.5px solid ' + boxBd + ';border-radius:16px;padding:16px;margin-bottom:16px;"><div style="font-size:14px;font-weight:700;color:' + titleCl + ';">' + cat.emoji + ' ' + statLabel(curSC) + '</div><div style="font-size:11px;color:#334155;margin-bottom:12px;">' + (__T('Unit: ','단위: ','单位: ','単位: ')) + statUnit(curSC) + '</div>';
  if (entries.length === 0) {
    chartHtml += '<div style="text-align:center;color:#334155;font-size:13px;padding:30px 0;">데이터가 없어요.<br>+ 입력으로 추가해보세요!</div>';
  } else {
    chartHtml += '<canvas id="sCanvas" style="width:100%;"></canvas>';
  }
  chartHtml += "</div>";

  var listHtml = '<div style="font-size:13px;font-weight:700;color:#334155;margin-bottom:8px;">' + (__T('Recent Records','최근 기록','最近记录','最近の記録')) + '</div>';
  entries.slice().reverse().slice(0,10).forEach(function(e, i) {
    var origIdx = entries.length - 1 - i;
    var valDisplay = (curSC === 'bp' && e.dia != null)
      ? '<span style="font-size:15px;font-weight:700;color:' + cat.color + ';">' + e.value + '/' + e.dia + ' <small style="font-size:11px;color:#334155;">mmHg</small></span>'
      : '<span style="font-size:15px;font-weight:700;color:' + cat.color + ';">' + e.value + ' <small style="font-size:11px;color:#334155;">' + cat.unit + '</small></span>';
    var row = '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:' + boxBg + ';border:1.5px solid ' + boxBd + ';border-radius:12px;margin-bottom:6px;">'
      + '<span style="font-size:13px;color:' + dateCl + ';">' + e.date + '</span>'
      + valDisplay
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
  var pL=40,pR=10,pT=12,pB=24,gW=W-pL-pR,gH=H-pT-pB;

  // 혈압: sys(수축) + dia(이완) 두 라인
  var isBp = (curSC === 'bp');
  var allVals = isBp
    ? entries.map(function(e){return parseFloat(e.value);}).concat(entries.map(function(e){return parseFloat(e.dia||0);}))
    : entries.map(function(e){return parseFloat(e.value);});
  var mn=Math.min.apply(null,allVals), mx=Math.max.apply(null,allVals), rng=mx-mn||1;

  for(var g=0;g<=4;g++){
    var gy=pT+(gH/4)*g;
    ctx.strokeStyle="#333";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pL,gy);ctx.lineTo(W-pR,gy);ctx.stroke();
    ctx.fillStyle="#334155";ctx.font="9px sans-serif";ctx.textAlign="right";
    ctx.fillText((mx-(rng/4)*g).toFixed(1),pL-3,gy+3);
  }

  function drawLine(vals, color, dashed) {
    var pts = entries.map(function(e,i){return{
      x:pL+(entries.length>1?(gW/(entries.length-1))*i:gW/2),
      y:pT+gH-((vals[i]-mn)/rng)*gH
    };});
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.lineJoin="round";
    if(dashed) ctx.setLineDash([4,4]); else ctx.setLineDash([]);
    pts.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});
    ctx.stroke();ctx.setLineDash([]);
    pts.forEach(function(p,i){
      ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
      ctx.fillStyle="#1A1A1A";ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
      if(entries.length<=7||i%Math.ceil(entries.length/6)===0){
        ctx.fillStyle="#334155";ctx.font="8px sans-serif";ctx.textAlign="center";
        ctx.fillText(entries[i].date.slice(5),p.x,H-2);
      }
    });
  }

  if(isBp){
    drawLine(entries.map(function(e){return parseFloat(e.value);}), "#ef4444", false);  // 수축
    drawLine(entries.map(function(e){return parseFloat(e.dia||0);}), "#f97316", true);  // 이완
  } else {
    var gr=ctx.createLinearGradient(0,pT,0,pT+gH);
    gr.addColorStop(0,cat.color+"44");gr.addColorStop(1,cat.color+"00");
    var vals=entries.map(function(e){return parseFloat(e.value);});
    var pts=entries.map(function(e,i){return{
      x:pL+(entries.length>1?(gW/(entries.length-1))*i:gW/2),
      y:pT+gH-((parseFloat(e.value)-mn)/rng)*gH
    };});
    ctx.beginPath();ctx.moveTo(pts[0].x,pT+gH);
    pts.forEach(function(p){ctx.lineTo(p.x,p.y);});
    ctx.lineTo(pts[pts.length-1].x,pT+gH);ctx.closePath();
    ctx.fillStyle=gr;ctx.fill();
    drawLine(vals, cat.color, false);
  }
}

function openSM() {
  var isDark = document.body.classList.contains('dark-mode');
  var boxBg  = isDark ? '#1A1A1A' : '#fff';
  var boxBd  = isDark ? '#2A2A2A' : '#e2e8f0';
  var textCl = isDark ? '#F1F1F1' : '#1e293b';
  var subCl  = isDark ? '#334155' : '#334155';
  var cancelBg = isDark ? '#2A2A2A' : '#f1f5f9';
  var cancelCl = isDark ? '#334155' : '#334155';

  var overlay = document.createElement("div");
  overlay.id = "smOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;";
  var today = new Date().toISOString().slice(0,10);

  var selOpts = "";
  Object.keys(STAT_CATS).forEach(function(k){
    selOpts += '<option value="' + k + '"' + (k===curSC?" selected":"") + '>' + statLabel(k) + " (" + statUnit(k) + ")</option>";
  });

  var inpStyle = "width:100%;padding:10px;border-radius:10px;border:1.5px solid " + boxBd + ";font-size:16px;margin-bottom:12px;box-sizing:border-box;background:" + boxBg + ";color:" + textCl + ";";
  var selStyle = "width:100%;padding:10px;border-radius:10px;border:1.5px solid " + boxBd + ";font-size:13px;margin-bottom:12px;box-sizing:border-box;background:" + boxBg + ";color:" + textCl + ";";

  overlay.innerHTML = '<div style="background:' + boxBg + ';border:1.5px solid ' + boxBd + ';border-radius:20px;padding:24px;width:85%;max-width:320px;">'
    + '<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:' + textCl + ';">수치 입력</div>'
    + '<div style="font-size:12px;color:' + subCl + ';margin-bottom:4px;">카테고리</div>'
    + '<select id="smCat" onchange="smCatChange()" style="' + selStyle + '">' + selOpts + '</select>'
    + '<div style="font-size:12px;color:' + subCl + ';margin-bottom:4px;">수치</div>'
    + '<div id="smValWrap"></div>'
    + '<div style="font-size:12px;color:' + subCl + ';margin-bottom:4px;">날짜</div>'
    + '<input id="smDate" type="date" value="' + today + '" style="' + inpStyle + '"/>'
    + '<button id="smSaveBtn" style="width:100%;padding:12px;background:var(--primary);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:8px;">저장</button>'
    + '<button id="smCancelBtn" style="width:100%;padding:10px;background:' + cancelBg + ';color:' + cancelCl + ';border:none;border-radius:12px;font-size:14px;cursor:pointer;">취소</button>'
    + '</div>';

  document.body.appendChild(overlay);
  smCatChange();
  document.getElementById("smSaveBtn").addEventListener("click", saveSE);
  document.getElementById("smCancelBtn").addEventListener("click", function(){ overlay.remove(); });
}

function smCatChange() {
  var isDark = document.body.classList.contains('dark-mode');
  var boxBg  = isDark ? '#1A1A1A' : '#fff';
  var boxBd  = isDark ? '#2A2A2A' : '#e2e8f0';
  var textCl = isDark ? '#F1F1F1' : '#1e293b';
  var subCl  = isDark ? '#334155' : '#334155';
  var inpStyle = "width:100%;padding:10px;border-radius:10px;border:1.5px solid " + boxBd + ";font-size:16px;box-sizing:border-box;background:" + boxBg + ";color:" + textCl + ";";

  var cat = document.getElementById("smCat").value;
  var wrap = document.getElementById("smValWrap");
  if (!wrap) return;
  if (cat === 'bp') {
    wrap.innerHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;">'
      + '<div style="flex:1;"><div style="font-size:11px;color:' + subCl + ';margin-bottom:4px;">수축기</div>'
      + '<input id="smValSys" type="number" step="1" placeholder="120" style="' + inpStyle + '"/></div>'
      + '<div style="flex:1;"><div style="font-size:11px;color:' + subCl + ';margin-bottom:4px;">이완기</div>'
      + '<input id="smValDia" type="number" step="1" placeholder="80" style="' + inpStyle + '"/></div>'
      + '</div>';
  } else {
    wrap.innerHTML = '<input id="smVal" type="number" step="0.1" placeholder="수치 입력" style="' + inpStyle + 'margin-bottom:12px;"/>';
  }
}

function saveSE() {
  var cat = document.getElementById("smCat").value;
  var date = document.getElementById("smDate").value;
  var data = getSD();
  if (!data[cat]) data[cat] = [];

  if (cat === 'bp') {
    var sys = document.getElementById("smValSys")?.value.trim();
    var dia = document.getElementById("smValDia")?.value.trim();
    if (!sys || !dia || !date) { showAlert("수치와 날짜를 입력해주세요"); return; }
    data[cat].push({ value: parseFloat(sys), dia: parseFloat(dia), date: date });
  } else {
    var val = document.getElementById("smVal")?.value.trim();
    if (!val || !date) { showAlert("수치와 날짜를 입력해주세요"); return; }
    data[cat].push({ value: parseFloat(val), date: date });
  }

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
    var hours = now.getHours();
    var isEn = localStorage.getItem('lang') === 'en';
    var ampm = hours >= 12 ? (__T('PM','오후','下午','午後')) : (__T('AM','오전','上午','午前'));
    var h12 = hours % 12 || 12;
    var h = String(h12).padStart(2,'0');
    var m = String(now.getMinutes()).padStart(2,'0');
    var s = String(now.getSeconds()).padStart(2,'0');
    var days = ['일','월','화','수','목','금','토'];
    var lang2 = localStorage.getItem('lang') || 'ko';
    var dateStr;
    if (lang2 === 'en') {
      var mns = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var dns = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      dateStr = mns[now.getMonth()] + ' ' + now.getDate() + ' (' + dns[now.getDay()] + ')';
    } else if (lang2 === 'zh') {
      var dnsZh = ['日','一','二','三','四','五','六'];
      dateStr = (now.getMonth()+1) + '月' + now.getDate() + '日 (周' + dnsZh[now.getDay()] + ')';
    } else if (lang2 === 'ja') {
      var dnsJa = ['日','月','火','水','木','金','土'];
      dateStr = (now.getMonth()+1) + '月' + now.getDate() + '日 (' + dnsJa[now.getDay()] + ')';
    } else {
      dateStr = (now.getMonth()+1) + '월 ' + now.getDate() + '일 (' + days[now.getDay()] + ')';
    }
    var el = document.getElementById('widgetClock');
    var del = document.getElementById('widgetDate');
    if (el) el.innerHTML = '<span style="font-size:13px;opacity:0.6;font-weight:600;margin-right:4px;">' + ampm + '</span>' + h + ' : ' + m + '<span style="font-size:18px;opacity:0.7;"> : ' + s + '</span>';
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
  var en = localStorage.getItem('lang') === 'en';
  if (pm10 <= 30) return { text: __T('Good','좋음','良好','良好'), color: '#4ade80' };
  if (pm10 <= 80) return { text: __T('Moderate','보통','一般','普通'), color: '#facc15' };
  if (pm10 <= 150) return { text: __T('Bad','나쁨','差','悪い'), color: '#fb923c' };
  return { text: __T('V.Bad','매우나쁨','极差','非常に悪い'), color: '#f87171' };
}

function getClothes(temp, pm10) {
  var lang = localStorage.getItem('lang') || 'ko';
  var mask = pm10 > 80 ? (__T('😷 Mask recommended','😷 마스크 착용 권장','😷 建议佩戴口罩','😷 マスク着用推奨')) : '';
  var top, bot;
  if (lang === 'en') {
    if (temp >= 28) { top = 'Sleeveless · T-shirt'; bot = 'Shorts · Dress'; }
    else if (temp >= 23) { top = 'T-shirt · Light shirt'; bot = 'Shorts'; }
    else if (temp >= 20) { top = 'Blouse · Long sleeve'; bot = 'Pants · Jeans'; }
    else if (temp >= 17) { top = 'Light cardigan'; bot = 'Long pants'; }
    else if (temp >= 12) { top = 'Jacket · Cardigan'; bot = 'Jeans'; }
    else if (temp >= 9)  { top = 'Trench coat · Knit'; bot = 'Jeans'; }
    else if (temp >= 5)  { top = 'Wool coat · Heattech'; bot = 'Layered'; }
    else                 { top = 'Padding · Thick coat'; bot = 'Scarf'; }
  } else if (lang === 'zh') {
    if (temp >= 28) { top = '无袖 · 短袖'; bot = '短裤 · 连衣裙'; }
    else if (temp >= 23) { top = '短袖 · 薄衬衫'; bot = '短裤'; }
    else if (temp >= 20) { top = '衬衫 · 长袖'; bot = '棉裤 · 牛仔裤'; }
    else if (temp >= 17) { top = '薄开衫'; bot = '长裤'; }
    else if (temp >= 12) { top = '夹克 · 开衫'; bot = '牛仔裤'; }
    else if (temp >= 9)  { top = '风衣 · 针织衫'; bot = '牛仔裤'; }
    else if (temp >= 5)  { top = '羊毛大衣 · 保暖内衣'; bot = '叠穿'; }
    else                 { top = '羽绒服 · 厚大衣'; bot = '围巾'; }
  } else if (lang === 'ja') {
    if (temp >= 28) { top = 'ノースリーブ · 半袖'; bot = 'ショートパンツ · ワンピース'; }
    else if (temp >= 23) { top = '半袖 · 薄手シャツ'; bot = 'ショートパンツ'; }
    else if (temp >= 20) { top = 'ブラウス · 長袖'; bot = 'コットンパンツ · ジーンズ'; }
    else if (temp >= 17) { top = '薄手カーディガン'; bot = '長ズボン'; }
    else if (temp >= 12) { top = 'ジャケット · カーディガン'; bot = 'ジーンズ'; }
    else if (temp >= 9)  { top = 'トレンチコート · ニット'; bot = 'ジーンズ'; }
    else if (temp >= 5)  { top = 'ウールコート · ヒートテック'; bot = '重ね着'; }
    else                 { top = 'ダウン · 厚手コート'; bot = 'マフラー'; }
  } else {
    if (temp >= 28) { top = '민소매 · 반팔'; bot = '반바지 · 원피스'; }
    else if (temp >= 23) { top = '반팔 · 얇은 셔츠'; bot = '반바지'; }
    else if (temp >= 20) { top = '블라우스 · 긴팔'; bot = '면바지 · 청바지'; }
    else if (temp >= 17) { top = '얇은 가디건'; bot = '긴바지'; }
    else if (temp >= 12) { top = '자켓 · 가디건'; bot = '청바지'; }
    else if (temp >= 9)  { top = '트렌치코트 · 니트'; bot = '청바지'; }
    else if (temp >= 5)  { top = '울코트 · 히트텍'; bot = '레이어드'; }
    else                 { top = '패딩 · 두꺼운 코트'; bot = '목도리'; }
  }
  return top + '\n' + bot + (mask ? '\n' + mask : '');
}

var _weatherCache = null;

function renderWeatherUI(data) {
  if (!data) return;
  var en = localStorage.getItem('lang') === 'en';
  document.getElementById('widgetTemp').textContent = data.temp + '°';
  document.getElementById('widgetDesc').textContent = data.desc;
  document.getElementById('widgetWeatherIcon').textContent = data.icon;
  document.getElementById('widgetLocation').textContent = data.city;
  document.getElementById('widgetTempMin').textContent = data.tMin + '°';
  document.getElementById('widgetTempMax').textContent = data.tMax + '°';
  var level = getDustLevel(data.pm10);
  var level25 = getDustLevel(data.pm25);
  document.getElementById('widgetDustVal').innerHTML =
    (__T('Fine dust ','미세 ','细颗粒 ','微小 ')) + '<b style="color:' + level.color + '">' + level.text + '</b><br>' +
    (__T('Ultra-fine ','초미세 ','超细颗粒 ','超微小 ')) + '<b style="color:' + level25.color + '">' + level25.text + '</b>';
  document.getElementById('widgetDustLevel').textContent = '';
  document.getElementById('widgetClothesVal').innerHTML = getClothes(data.temp, data.pm10).replace(/\n/g, '<br>');
}

async function loadWeather() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async function(pos) {
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    try {
      var en = localStorage.getItem('lang') === 'en';
      var wLang = __T('en','kr','zh','ja');
      var wRes = await fetch('https://api.openweathermap.org/data/2.5/weather?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY+'&units=metric&lang='+wLang);
      var wData = await wRes.json();
      var fRes = await fetch('https://api.openweathermap.org/data/2.5/forecast?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY+'&units=metric&cnt=8');
      var fData = await fRes.json();
      var todayTemps = fData.list.map(function(item){ return item.main.temp; });
      var aRes = await fetch('https://api.openweathermap.org/data/2.5/air_pollution?lat='+lat+'&lon='+lon+'&appid='+OWM_KEY);
      var aData = await aRes.json();
      _weatherCache = {
        temp: Math.round(wData.main.temp),
        desc: wData.weather[0].description,
        icon: getWeatherIcon(wData.weather[0].id),
        city: wData.name,
        tMin: Math.round(Math.min.apply(null, todayTemps)),
        tMax: Math.round(Math.max.apply(null, todayTemps)),
        pm10: Math.round(aData.list[0].components.pm10),
        pm25: Math.round(aData.list[0].components.pm2_5),
      };
      renderWeatherUI(_weatherCache);
    } catch(e) {
      var en = localStorage.getItem('lang') === 'en';
      document.getElementById('widgetClothesVal').textContent = __T('No weather info','날씨 정보 없음','无天气信息','天気情報なし');
    }
  }, function() {
    var en = localStorage.getItem('lang') === 'en';
    document.getElementById('widgetClothesVal').textContent = __T('Location permission needed','위치 권한 필요','需要位置权限','位置情報の権限が必要');
  });
}

// 날씨 주기적 갱신
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
  // 뒤로가기로 뷰어 닫기
  history.pushState({ imgViewer: true }, '');

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
    notifSection: '알림', notifApp: '앱 알림 (메모/일정/할일/통계)',
    notifEvent: '이벤트 알림 (채팅)',
    language: '언어',
    todoTitle: '할 일', todoPlaceholder: '새 할 일 추가...',
    memoTitle: '메모', calendarTitle: '달력',
    statsTitle: '건강 통계', statInput: '수치 입력',
    recentRecord: '최근 기록',
    noData: '데이터가 없어요.\n+ 입력으로 추가해보세요!',
    chatList: '목록', noFriend: '친구를 추가하면 채팅이 시작됩니다',
    msgPlaceholder: '메시지 입력...',
    dust: '미세먼지', clothes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:middle;margin-right:3px;color:var(--primary);"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>옷차림 추천',
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
    notifSection: 'Notifications', notifApp: 'App Alerts (Memo/Schedule/To-Do/Stats)',
    notifEvent: 'Event Alerts (Chat)',
    language: 'Language',
    todoTitle: 'To-Do', todoPlaceholder: 'Add new task...',
    memoTitle: 'Memo', calendarTitle: 'Calendar',
    statsTitle: 'Health Stats', statInput: 'Enter Data',
    recentRecord: 'Recent Records',
    noData: 'No data yet.\nTap + to add!',
    chatList: 'List', noFriend: 'Add a friend to start chatting',
    msgPlaceholder: 'Type a message...',
    dust: 'Air Quality', clothes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:middle;margin-right:3px;color:var(--primary);"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>Outfit Tip',
    loading: 'Loading...', locationNeeded: 'Location permission needed',
    cancel: 'Cancel', save2: 'Save', delete: 'Delete',
  },
  zh: {
    todo: '待办', schedule: '日程', alarm: '闹钟',
    memo: '备忘', goal: '目标', stats: '统计',
    project: '项目', tag: '标签', calendar: '日历',
    settings: '设置', back: '← 返回',
    settingsTitle: '设置', appNameLabel: '应用名称',
    save: '保存', themeColor: '主题色',
    notifSection: '通知', notifApp: '应用提醒 (备忘/日程/待办/统计)',
    notifEvent: '事件提醒 (聊天)',
    language: '语言',
    todoTitle: '待办', todoPlaceholder: '添加新任务...',
    memoTitle: '备忘', calendarTitle: '日历',
    statsTitle: '健康统计', statInput: '输入数据',
    recentRecord: '最近记录',
    noData: '暂无数据。\n点击+添加!',
    chatList: '列表', noFriend: '添加好友后可开始聊天',
    msgPlaceholder: '输入消息...',
    dust: '空气质量', clothes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:middle;margin-right:3px;color:var(--primary);"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>穿搭推荐',
    loading: '加载中...', locationNeeded: '需要位置权限',
    cancel: '取消', save2: '保存', delete: '删除',
  },
  ja: {
    todo: 'タスク', schedule: '予定', alarm: 'アラーム',
    memo: 'メモ', goal: '目標', stats: '統計',
    project: 'プロジェクト', tag: 'タグ', calendar: 'カレンダー',
    settings: '設定', back: '← 戻る',
    settingsTitle: '設定', appNameLabel: 'アプリ名',
    save: '保存', themeColor: 'テーマカラー',
    notifSection: '通知', notifApp: 'アプリ通知 (メモ/予定/タスク/統計)',
    notifEvent: 'イベント通知 (チャット)',
    language: '言語',
    todoTitle: 'タスク', todoPlaceholder: '新しいタスクを追加...',
    memoTitle: 'メモ', calendarTitle: 'カレンダー',
    statsTitle: '健康統計', statInput: '数値入力',
    recentRecord: '最近の記録',
    noData: 'データがありません。\n+で追加してください!',
    chatList: 'リスト', noFriend: '友達を追加するとチャットが始まります',
    msgPlaceholder: 'メッセージを入力...',
    dust: 'PM2.5', clothes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:middle;margin-right:3px;color:var(--primary);"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>服装提案',
    loading: '読み込み中...', locationNeeded: '位置情報の権限が必要',
    cancel: 'キャンセル', save2: '保存', delete: '削除',
  }
};

let currentLang = localStorage.getItem('lang') || 'ko';

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || (I18N['ko'][key]) || key;
}

// 4언어 인라인 헬퍼: __T(en, ko, zh, ja)
// 현재 lang에 따라 해당 문자열을 반환. zh/ja가 누락되면 en으로 fallback.
function __T(en, ko, zh, ja) {
  var lang = localStorage.getItem('lang') || 'ko';
  if (lang === 'en') return en;
  if (lang === 'zh') return (zh != null ? zh : en);
  if (lang === 'ja') return (ja != null ? ja : en);
  return ko;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
  // <html lang="..."> 동적 변경
  try {
    var htmlLangMap = { en: 'en', ko: 'ko', zh: 'zh', ja: 'ja' };
    document.documentElement.setAttribute('lang', htmlLangMap[lang] || 'ko');
  } catch(e) {}
  applyLang();
  renderWeatherUI(_weatherCache);
}

function applyLang() {
  currentLang = localStorage.getItem('lang') || 'ko';
  try {
    var _hlm = { en: 'en', ko: 'ko', zh: 'zh', ja: 'ja' };
    document.documentElement.setAttribute('lang', _hlm[currentLang] || 'ko');
  } catch(e) {}
  var en = currentLang === 'en';
  updatePlanDate();

  var sel = document.getElementById('langSelect');
  if (sel) sel.value = currentLang;

  // 메인 메뉴
  var menuLabels = document.querySelectorAll('#menuGrid .menu-label');
  var menuKeys = ['todo','schedule','alarm','memo','goal','stats','project','tag','calendar'];
  menuLabels.forEach(function(el,i){ if(menuKeys[i]) el.textContent = t(menuKeys[i]); });

  // 날짜 배너
  _setText('dateSubtitle', __T("Check today's schedule",'오늘의 일정을 확인하세요','查看今日日程','今日の予定を確認'));

  // 서브타이틀
  _setText('settingsTitle', __T('Settings','설정','设置','設定'));
  _setText('todoTitle', __T('To-Do','할 일','待办','タスク'));
  _setText('memoTitle', __T('Memo','메모','备忘','メモ'));
  _setText('calendarTitle', __T('Calendar','달력','日历','カレンダー'));
  _setText('statsTitle', __T('Health Stats','건강 통계','健康统计','健康統計'));
  _setText('chatListTitle', __T('List','목록','列表','リスト'));
  _setText('newMemoTitle', __T('New Memo','새 메모','新建备忘','新規メモ'));
  _setText('featureTitle', document.getElementById('featureTitle') ? document.getElementById('featureTitle').textContent : '');

  // sub-title bold: 영문 bold, 한글 normal
  document.querySelectorAll('.sub-title').forEach(function(el){ el.style.fontWeight = __T('800','400','800','800'); });

  // back 버튼은 SVG 아이콘으로 고정 — 언어 전환 불필요

  // 설정 라벨
  _setText('appNameLabel', __T('App Name','앱 이름','应用名称','アプリ名'));
  _setText('iconStyleLabel', __T('Icon Style','아이콘 스타일','图标样式','アイコンスタイル'));
  _setText('iconStyleEmoji', __T('Emoji','이모지','表情符号','絵文字'));
  _setText('iconStyleSvg',   __T('SVG Line','SVG 라인','SVG 线条','SVGライン'));
  _setText('svgColorLabel', __T('SVG Line Color','SVG 라인 색상','SVG 线条颜色','SVGライン色'));
  _setText('svgColorOn',    __T('Individual','개별 색상','单独颜色','個別色'));
  _setText('svgColorOff',   __T('Theme Color','테마 색상','主题色','テーマカラー'));
  _setText('appTitleLabel', __T('App Title','앱 타이틀','应用标题','アプリタイトル'));
  _setText('titleColorHint', __T('Long-press to pick color & size','롱프레스로 색상·크기 선택','长按选择颜色和大小','長押しで色とサイズを選択'));
  _setText('displayModeLabel', __T('Display Mode','화면 모드','显示模式','表示モード'));
  _setText('darkModeText', __T('Dark Mode','다크 모드','深色模式','ダークモード'));
  _setText('themeColorLabel', __T('Theme Color','테마 색상','主题色','テーマカラー'));
  _setText('themeColorPaletteLabel', __T('Select theme color','테마 색상 선택','选择主题色','テーマカラー選択'));
  _setText('themeColorPaletteCancelBtn', __T('Close','닫기','关闭','閉じる'));
  _setText('notifSectionLabel', __T('Notifications','알림','通知','通知'));
  _setText('langLabel', __T('Language','언어','语言','言語'));
  _setText('infoLabel', __T('Info','정보','信息','情報'));
  _setText('notifEventLabel', __T('Event Alerts','이벤트 알림','事件提醒','イベント通知'));
  _setText('notifAppLabel', __T('App Alerts','앱 알림','应用提醒','アプリ通知'));
  _setText('shareTargetLabel', __T('Share Target :','공유 대상 :','共享对象 :','共有相手 :'));
  _setText('shareTargetBtn', __T('Change','변경','更改','変更'));
  _setText('shareTargetModalTitle', __T('Select Share Target','공유 대상 선택','选择共享对象','共有相手を選択'));
  _setText('shareReqTitle',       __T('Share Request','공유 요청','共享请求','共有リクエスト'));
  _setText('restoreTitle',        __T('Enter Your Code','내 코드 입력','输入您的代码','コードを入力'));
  _setText('restoreDesc',         __T('Enter your code','사용하실 코드를 입력하세요','请输入要使用的代码','使用するコードを入力してください'));
  _setText('restoreCancelBtn',    __T('Cancel','취소','取消','キャンセル'));
  _setText('restoreOkBtn',        __T('OK','확인','确定','OK'));
  _setText('shareReqDescText',    __T(' sent you a share request.','님이 공유 대상으로 지정했습니다.',' 已将您指定为共享对象。',' さんがあなたを共有相手に指定しました。'));
  _setText('shareReqHint',        __T('Accept to share Memo/To-Do/Schedule/Stats together.','승인하면 메모/할일/일정/통계를 함께 사용합니다.','同意后将共享备忘/待办/日程/统计。','承認するとメモ/タスク/予定/統計を共有します。'));
  _setText('shareReqRejectBtn',   __T('Reject','거절','拒绝','拒否'));
  _setText('shareReqAcceptBtn',   __T('Accept','승인','同意','承認'));
  _setText('shareTargetModalDesc', __T('Choose a friend to share Memo/To-Do/Schedule/Stats with','메모/할일/일정/통계를 함께 사용할 친구를 선택하세요','选择共享备忘/待办/日程/统计的好友','メモ/タスク/予定/統計を共有する友達を選択'));
  _setText('shareTargetCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('shareTargetClearBtn', __T('Clear','해제','解除','解除'));

  // 메모
  _setText('newMemoBtn', __T('+ New','+ 새 메모','+ 新建','+ 新規'));
  _setText('memoSaveBtn', __T('Save','저장','保存','保存'));
  var memoTP = document.getElementById('memoTitleInput');
  if(memoTP) memoTP.placeholder = __T('Title','제목','标题','タイトル');
  var memoCP = document.getElementById('memoContent');
  if(memoCP) memoCP.placeholder = __T('Enter memo...','메모를 입력하세요...','输入备忘...','メモを入力...');

  // 달력
  _setText('calRefreshBtn', __T('Refresh','새로고침','刷新','更新'));

  // 친구추가 모달
  _setText('addFriendTitle', __T('Add Friend','친구 추가','添加好友','友達追加'));
  _setText('tabCode', __T('Code','코드','代码','コード'));
  _setText('tabQRScan', __T('QR Scan','QR 스캔','扫描二维码','QRスキャン'));
  _setText('tabMyQR', __T('My QR','내 QR','我的二维码','マイQR'));
  _setText('addFriendBtn', __T('Add','추가','添加','追加'));
  _setText('regenCodeBtn', __T('🔄 Regenerate','🔄 코드 재생성','🔄 重新生成代码','🔄 コード再生成'));

  // 태그 화면
  // tagBackBtn은 SVG 아이콘 고정
  _setText('tagTitle', __T('Tags','태그','标签','タグ'));
  _setText('tagDeleteAllBtn', __T('Clear All','전체삭제','全部清除','全て削除'));
  _setText('tagAutoDeleteLabel', __T('Auto Delete','자동삭제','自动删除','自動削除'));
  _setText('tagAuto0', __T('Off','끄기','关闭','オフ'));
  _setText('tagAuto1', __T('1 day','1일','1天','1日'));
  _setText('tagAuto7', __T('7 days','7일','7天','7日'));
  _setText('tagAuto30', __T('30 days','30일','30天','30日'));

  // 자동삭제
  _setText('autoDeleteTitle', __T('Auto-Delete Timer','자동삭제 시간','自动删除时间','自動削除タイマー'));
  _setText('closeTimerBtn', __T('Cancel','취소','取消','キャンセル'));
  // deleteNowBtn 텍스트는 _resetTimerModal에서 lang 기준으로 동적 처리

  // 보안설정
  _setText('securityTitle', __T('Settings','설정','设置','設定'));
  _setText('themeLabel2', __T('Theme','테마','主题','テーマ'));
  _setText('fontSizeLabel', __T('Font Size','폰트 크기','字体大小','文字サイズ'));
  _setText('lockPatternLabel', __T('Lock Pattern','잠금 패턴','锁定图案','ロックパターン'));
  _setText('patternChangeBtn', __T('New Pattern','변경','更改','変更'));
  _setText('patternSetupTitle', __T('Change Pattern','패턴 변경','更改图案','パターン変更'));
  _setText('patternGuide', __T('Drag to draw a new pattern (min. 4)','메뉴를 드래그해서 새 패턴 입력 (최소 4개)','拖动菜单绘制新图案 (至少4个)','メニューをドラッグして新パターン入力 (最低4個)'));
  _setPatternBtn(false);
  _setText('enhancedSecLabel', __T('Enhanced Security','강화 보안','增强安全','強化セキュリティ'));
  _setText('autoLockDesc', __T('Auto-lock chat when leaving screen','화면 이탈 시 채팅 자동 잠금','离开屏幕时自动锁定聊天','画面離脱時にチャット自動ロック'));
  _setText('myCodeLabel', __T('My Code :','내 코드 :','我的代码 :','マイコード :'));
  _setText('changeCodeTitle', __T('Change ID Code','식별 코드 변경','更改识别代码','識別コード変更'));
  _setText('changeCodeDesc',  __T('Enter a new ID code','새 식별 코드를 입력하세요','输入新的识别代码','新しい識別コードを入力'));
  _setText('changeCodeCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('changeCodeConfirm', __T('OK','확인','确定','OK'));
  _setText('changeChoiceTitle', __T('Data Handling','데이터 처리','数据处理','データ処理'));
  _setText('changeChoiceDesc',  __T('What to do with existing data after code change?','코드 변경 후 기존 데이터를 어떻게 할까요?','更改代码后如何处理现有数据?','コード変更後、既存データをどうしますか?'));
  _setText('changeChoiceKeepBtn', __T('Keep Data','데이터 유지','保留数据','データ保持'));
  _setText('changeChoiceResetBtn', __T('Reset Data','데이터 초기화','重置数据','データ初期化'));
  _setText('changeChoiceCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  var hintEl = document.getElementById('changeChoiceHint');
  if (hintEl) {
    var keep = __T('Keep','유지','保留','保持');
    var reset = __T('Reset','초기화','重置','初期化');
    var _hL = localStorage.getItem('lang') || 'ko';
    var _h;
    if (_hL === 'en') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: Memo/To-Do/Stats/Calendar/Settings preserved. Friends, chats, shared data removed.<br><b style="color:#ef4444;">' + reset + '</b>: All data permanently deleted from server and device.';
    } else if (_hL === 'zh') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: 备忘/待办/统计/日历/设置将保留。好友、聊天、共享数据将被删除。<br><b style="color:#ef4444;">' + reset + '</b>: 所有数据将从服务器和设备永久删除。';
    } else if (_hL === 'ja') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: メモ/タスク/統計/カレンダー/設定は保持されます。友達、チャット、共有データは削除されます。<br><b style="color:#ef4444;">' + reset + '</b>: 全データがサーバーと端末から永久に削除されます。';
    } else {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: 메모/할일/통계/달력/설정은 보존하고, 친구·채팅·공유 데이터만 삭제됩니다.<br><b style="color:#ef4444;">' + reset + '</b>: 모든 데이터가 서버와 기기에서 영구 삭제됩니다.';
    }
    hintEl.innerHTML = _h;
  }
  _setText('changeCodeConfirm', __T('Confirm','변경 확인','确认更改','変更を確認'));

  // 패턴
  _setText('patternSaveBtn', __T('Save Pattern','패턴 저장','保存图案','パターン保存'));

  // 통계
  _setText('statAddBtn', __T('+ Add','+ 입력','+ 添加','+ 入力'));
  _setText('statInputTitle', __T('Enter Data','수치 입력','输入数据','数値入力'));
  _setText('statCatLabel', __T('Category','카테고리','类别','カテゴリ'));
  _setText('statValLabel', __T('Value','수치','数值','数値'));
  _setText('statDateLabel', __T('Date','날짜','日期','日付'));

  // 날씨
  _setText('dustLabel', __T('Air Quality','미세먼지','空气质量','PM2.5'));
  applyClothesIcon(en);

  // placeholder
  var todoEl = document.getElementById('todoInputEl') || document.getElementById('todoInput');
  if(todoEl) todoEl.placeholder = __T('Add new task...','새 할 일 추가...','添加新任务...','新しいタスクを追加...');
  var msgEl = document.getElementById('msgInput');
  if(msgEl) msgEl.placeholder = __T('Type a message...','메시지 입력...','输入消息...','メッセージを入力...');

  // 이미지 다운로드
  _setText('imgDownloadBtn', __T('⬇ Save','⬇ 저장','⬇ 保存','⬇ 保存'));

  // 보안설정 내부 버튼
  var dBtn = document.getElementById('themeDarkBtn'); if(dBtn) dBtn.textContent = __T('Dark','다크','深色','ダーク');
  var lBtn = document.getElementById('themeLightBtn'); if(lBtn) lBtn.textContent = __T('Light','라이트','浅色','ライト');
  _setText('fontSmLabel', __T('S','소','小','小'));
  _setText('fontMdLabel', __T('M','중','中','中'));
  _setText('fontLgLabel', __T('L','대','大','大'));
  _setText('changeCodeBtn', __T('New Code','변경','更改','変更'));
  _setText('closeSecretBtn', __T('OK','확인','确定','OK'));
  _setText('closeAddFriendBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('addFriendBtn', __T('Add','추가','添加','追加'));
  _setText('changeCodeTitle', __T('Change ID Code','식별 코드 변경','更改识别代码','識別コード変更'));
  _setText('changeCodeDesc',  __T('Enter a new ID code','새 식별 코드를 입력하세요','输入新的识别代码','新しい識別コードを入力'));
  _setText('changeCodeCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('changeCodeConfirm', __T('OK','확인','确定','OK'));
  _setText('changeChoiceTitle', __T('Data Handling','데이터 처리','数据处理','データ処理'));
  _setText('changeChoiceDesc',  __T('What to do with existing data after code change?','코드 변경 후 기존 데이터를 어떻게 할까요?','更改代码后如何处理现有数据?','コード変更後、既存データをどうしますか?'));
  _setText('changeChoiceKeepBtn', __T('Keep Data','데이터 유지','保留数据','データ保持'));
  _setText('changeChoiceResetBtn', __T('Reset Data','데이터 초기화','重置数据','データ初期化'));
  _setText('changeChoiceCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  var hintEl = document.getElementById('changeChoiceHint');
  if (hintEl) {
    var keep = __T('Keep','유지','保留','保持');
    var reset = __T('Reset','초기화','重置','初期化');
    var _hL = localStorage.getItem('lang') || 'ko';
    var _h;
    if (_hL === 'en') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: Memo/To-Do/Stats/Calendar/Settings preserved. Friends, chats, shared data removed.<br><b style="color:#ef4444;">' + reset + '</b>: All data permanently deleted from server and device.';
    } else if (_hL === 'zh') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: 备忘/待办/统计/日历/设置将保留。好友、聊天、共享数据将被删除。<br><b style="color:#ef4444;">' + reset + '</b>: 所有数据将从服务器和设备永久删除。';
    } else if (_hL === 'ja') {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: メモ/タスク/統計/カレンダー/設定は保持されます。友達、チャット、共有データは削除されます。<br><b style="color:#ef4444;">' + reset + '</b>: 全データがサーバーと端末から永久に削除されます。';
    } else {
      _h = '<b style="color:#f59e0b;">' + keep + '</b>: 메모/할일/통계/달력/설정은 보존하고, 친구·채팅·공유 데이터만 삭제됩니다.<br><b style="color:#ef4444;">' + reset + '</b>: 모든 데이터가 서버와 기기에서 영구 삭제됩니다.';
    }
    hintEl.innerHTML = _h;
  }
  _setText('changeCodeDesc', __T('⚠️ All friends will be deleted on both sides','⚠️ 변경 시 모든 친구가 양측에서 삭제됩니다','⚠️ 更改时双方所有好友将被删除','⚠️ 変更時に双方の全ての友達が削除されます'));
  _setText('changeCodeConfirm', __T('Confirm','변경 확인','确认更改','変更を確認'));
  _setText('changeCodeCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  var inp = document.getElementById('newCodeInput');
  if (inp) inp.placeholder = __T('Enter new ID code','새 식별 코드 입력','输入新识别代码','新識別コード入力');
  _setText('closeTimerBtn', __T('Cancel','취소','取消','キャンセル'));

  // 달력 통계
  _setText('calAchievedLabel', __T('Achieved','달성일','达成日','達成日'));
  _setText('calRateLabel', __T('Rate','달성률','达成率','達成率'));
  _setText('calStreakLabel', __T('Streak','연속 달성','连续达成','連続達成'));

  // 알림 토글
  _setText('notifEventLabel', __T('Event Alerts','이벤트 알림','事件提醒','イベント通知'));
  _setText('notifAppLabel', __T('App Alerts','앱 알림','应用提醒','アプリ通知'));
  _setText('shareTargetLabel', __T('Share Target :','공유 대상 :','共享对象 :','共有相手 :'));
  _setText('shareTargetBtn', __T('Change','변경','更改','変更'));
  _setText('shareTargetModalTitle', __T('Select Share Target','공유 대상 선택','选择共享对象','共有相手を選択'));
  _setText('shareReqTitle',       __T('Share Request','공유 요청','共享请求','共有リクエスト'));
  _setText('restoreTitle',        __T('Enter Your Code','내 코드 입력','输入您的代码','コードを入力'));
  _setText('restoreDesc',         __T('Enter your code','사용하실 코드를 입력하세요','请输入要使用的代码','使用するコードを入力してください'));
  _setText('restoreCancelBtn',    __T('Cancel','취소','取消','キャンセル'));
  _setText('restoreOkBtn',        __T('OK','확인','确定','OK'));
  _setText('shareReqDescText',    __T(' sent you a share request.','님이 공유 대상으로 지정했습니다.',' 已将您指定为共享对象。',' さんがあなたを共有相手に指定しました。'));
  _setText('shareReqHint',        __T('Accept to share Memo/To-Do/Schedule/Stats together.','승인하면 메모/할일/일정/통계를 함께 사용합니다.','同意后将共享备忘/待办/日程/统计。','承認するとメモ/タスク/予定/統計を共有します。'));
  _setText('shareReqRejectBtn',   __T('Reject','거절','拒绝','拒否'));
  _setText('shareReqAcceptBtn',   __T('Accept','승인','同意','承認'));
  _setText('shareTargetModalDesc', __T('Choose a friend to share Memo/To-Do/Schedule/Stats with','메모/할일/일정/통계를 함께 사용할 친구를 선택하세요','选择共享备忘/待办/日程/统计的好友','メモ/タスク/予定/統計を共有する友達を選択'));
  _setText('shareTargetCancelBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('shareTargetClearBtn', __T('Clear','해제','解除','解除'));

  // 닉네임 설정
  _setText('nicknameLabel', __T('Set your nickname','닉네임을 설정하세요','设置您的昵称','ニックネームを設定'));
  _setText('nicknameSetBtn', __T('Set','설정','设置','設定'));
  _setText('exitChatBtn', __T('← Exit','← 나가기','← 退出','← 退出'));
  var nnInput = document.getElementById('nicknameInput');
  if (nnInput) nnInput.placeholder = __T('Enter nickname','닉네임 입력','输入昵称','ニックネーム入力');

  // 할일 빈 목록 갱신
  var emptyState = document.querySelector('.empty-state');
  if (emptyState) emptyState.innerHTML = (__T('No tasks yet','할 일이 없습니다','暂无任务','タスクがありません'));

  // 달력 갱신 (요일 헤더)
  var calScreen = document.getElementById('calendarScreen');
  if (calScreen && calScreen.classList.contains('active')) renderCalendar();

  // 친구추가 모달
  _setText('friendCodeDesc', __T("Enter your friend's ID code",'친구의 식별 코드를 입력하세요','输入好友的识别代码','友達の識別コードを入力'));
  var fci = document.getElementById('friendCodeInput2') || document.getElementById('friendCodeInput');
  if (fci) fci.placeholder = __T('Enter friend code','친구 코드 입력','输入好友代码','友達コード入力');
  _setText('qrScanDesc', __T("Scan your friend's QR code",'친구의 QR코드를 스캔하세요','扫描好友的二维码','友達のQRコードをスキャン'));
  _setText('myQrDesc', __T('Show your QR code to your friend','내 QR코드를 친구에게 보여주세요','向好友展示您的二维码','自分のQRコードを友達に見せて'));

  // 닉네임 placeholder
  var nnInput2 = document.getElementById('myCodeInput');
  if (nnInput2) nnInput2.placeholder = __T('Enter nickname','닉네임 입력','输入昵称','ニックネーム入力');

  // ── 추가 누락 ID들 ──
  // 메모 에디터 타이틀, 날씨 위젯 로딩 문구, 통계 빈 상태, 타이머 모달 등
  _setText('memoEditorTitle', __T('New Memo','새 메모','新建备忘','新規メモ'));
  _setText('statEmpty', __T('No data yet.\nTap + to add!','데이터가 없어요.\n+ 입력으로 추가해보세요!','暂无数据。\n点击+添加!','データがありません。\n+で追加してください!'));
  _setText('timerModalDesc', __T('Requires partner approval to change','변경 시 상대방 동의가 필요합니다','变更需对方同意','変更には相手の同意が必要です'));
  _setText('paletteCancelBtn', __T('Close','닫기','关闭','閉じる'));
  _setText('savePatternBtn', __T('Cancel','취소','取消','キャンセル'));
  _setText('customAlertOk', __T('OK','확인','确定','OK'));
  _setText('customConfirmCancel', __T('Cancel','취소','取消','キャンセル'));
  _setText('customConfirmOk', __T('OK','확인','确定','OK'));
  _setText('changeChoiceKeepLabel', __T('Keep','유지','保留','保持'));
  _setText('changeChoiceResetLabel', __T('Reset','초기화','重置','初期化'));
  // 폰트 사이즈 팔레트 버튼들
  _setText('fontSizeBtn24', __T('S','소','小','小'));
  _setText('fontSizeBtn28', __T('M','중','中','中'));
  _setText('fontSizeBtn32', __T('L','대','大','大'));
  // 이미지 다운로드 버튼
  var imgDl = document.getElementById('imgViewerDownload');
  if (imgDl) imgDl.textContent = __T('⬇ Save','⬇ 저장','⬇ 保存','⬇ 保存');
  // 메모 본문 placeholder (contenteditable)
  var mci = document.getElementById('memoContentInput');
  if (mci) mci.setAttribute('data-placeholder', __T('Enter content...','내용을 입력하세요...','输入内容...','内容を入力...'));
  // 통계 입력 placeholder
  var svInput = document.getElementById('statValueInput');
  if (svInput) svInput.placeholder = __T('Enter value','수치 입력','输入数据','数値入力');
  // 복구 코드 placeholder
  var rci = document.getElementById('restoreCodeInput');
  if (rci) rci.placeholder = __T('Enter code','코드 입력','输入代码','コード入力');
  // 위젯 초기 로딩 문구 (날씨 데이터가 아직 없을 때만)
  var wd = document.getElementById('widgetDesc');
  if (wd && (wd.textContent === '로딩 중...' || wd.textContent === 'Loading...' || wd.textContent === '加载中...' || wd.textContent === '読み込み中...')) {
    wd.textContent = __T('Loading...','로딩 중...','加载中...','読み込み中...');
  }
  var wcv = document.getElementById('widgetClothesVal');
  if (wcv && (wcv.textContent === '로딩 중...' || wcv.textContent === 'Loading...' || wcv.textContent === '加载中...' || wcv.textContent === '読み込み中...')) {
    wcv.textContent = __T('Loading...','로딩 중...','加载中...','読み込み中...');
  }
  // 자동삭제 라벨 갱신
  try { if (typeof updateAutoDeleteLabel === 'function') updateAutoDeleteLabel(); } catch(e) {}
  // 폰트 사이즈 버튼 텍스트
  try { if (typeof updateFontSizeBtns === 'function') updateFontSizeBtns(); } catch(e) {}
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// 앱 로드 시 적용
setTimeout(applyLang, 300);
