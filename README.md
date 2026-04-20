# 🔐 보안 채팅 PWA — 설치 가이드

## 앱 구조
- **겉모습**: MyPlanner (일정관리 앱)
- **실제기능**: 보안 1:1 채팅
- **잠금해제**: 9개 메뉴를 드래그 패턴으로 연결

---

## 1단계 — Firebase 프로젝트 생성 (모바일 가능)

1. https://console.firebase.google.com 접속
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: secure-chat-app)
4. Google Analytics: 사용 안함 선택 → **프로젝트 만들기**

---

## 2단계 — Firestore 데이터베이스 설정

1. 왼쪽 메뉴 → **Firestore Database** → **데이터베이스 만들기**
2. **테스트 모드**로 시작 (나중에 보안 규칙 변경)
3. 위치: `asia-northeast3 (서울)` 선택

### Firestore 보안 규칙 (Rules 탭에서 설정)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/messages/{msgId} {
      allow read, write: if true;
    }
  }
}
```

---

## 3단계 — Storage 설정

1. 왼쪽 메뉴 → **Storage** → **시작하기**
2. **테스트 모드** 선택
3. 위치: `asia-northeast3` 선택

---

## 4단계 — 웹앱 등록 및 Firebase Config 복사

1. 프로젝트 홈 → `</>` (웹) 아이콘 클릭
2. 앱 닉네임: `secure-chat` 입력 → **앱 등록**
3. **firebaseConfig** 코드 전체 복사

---

## 5단계 — app.js에 Config 붙여넣기

`app.js` 상단의 아래 부분을 복사한 내용으로 교체:

```javascript
const firebaseConfig = {
  apiKey: "실제키",
  authDomain: "프로젝트.firebaseapp.com",
  projectId: "프로젝트ID",
  storageBucket: "프로젝트.appspot.com",
  messagingSenderId: "번호",
  appId: "앱ID"
};
```

---

## 6단계 — 웹 호스팅 (무료)

### 방법 A: Firebase Hosting (추천)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### 방법 B: GitHub Pages (무료)
1. GitHub 계정 → 새 repository 생성
2. 앱 파일 전체 업로드
3. Settings → Pages → Branch: main 선택

### 방법 C: Netlify (드래그앤드롭)
1. https://netlify.com 접속
2. 앱 폴더 전체를 드래그앤드롭
3. 자동 배포 완료

---

## 7단계 — 홈화면에 추가 (PWA 설치)

### iOS (Safari)
1. Safari로 앱 URL 접속
2. 하단 공유 버튼 (□↑) 탭
3. **홈 화면에 추가** 선택
4. 이름 확인 후 **추가**

### Android (Chrome)
1. Chrome으로 앱 URL 접속
2. 주소창 오른쪽 메뉴 (⋮)
3. **앱 설치** 또는 **홈 화면에 추가**

---

## 앱 사용법

### 패턴 설정 (최초 1회)
1. 앱 열기 → 우측 상단 ⚙️ 설정
2. **패턴 변경** → 메뉴 4개 이상 드래그 연결
3. **패턴 저장**

### 채팅 진입
- 메인 화면에서 설정한 패턴으로 드래그 → 채팅앱 진입

### 채팅 사용
1. 처음 진입 시 **개인 식별 코드** 설정
2. 친구등록(👤+) → 친구 코드 입력
3. 채팅 시작

---

## 주의사항
- 아이콘 이미지: `icons/icon-192.png`, `icons/icon-512.png` 파일 추가 필요
- HTTPS 환경에서만 PWA 설치 가능 (Firebase/Netlify 모두 기본 HTTPS)
- iOS에서 푸시 알림은 iOS 16.4 이상만 지원
