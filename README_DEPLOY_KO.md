# 퀴즈쇼 최종 배포본

## 기능
- /host : 진행자 화면
- /join : 참가자 화면
- 미리 문제/보기/정답/점수 설정
- 진행 중 문제 수정 가능
- 진행자가 다음 문제를 누르면 참가자 화면도 동기화
- 참가자가 선택한 답을 본인 화면에 표시
- 진행자가 정답 공개를 누를 때만 정답 결과 표시
- 정답: 초록색 원, 오답: 빨간색 X
- 문제별 점수 자동 지급
- 점수는 진행자 화면에만 표시

## 실행
Node.js 18 이상 권장.

npm install
npm start

브라우저:
http://localhost:3000/host
참가자:
http://localhost:3000/join

## 인터넷 배포
이 폴더를 GitHub에 올린 뒤 Render, Railway, Fly.io 등의 Node.js 서비스에서 배포하세요.
Start Command:
npm start

배포가 완료되면 생성된 HTTPS 주소 뒤에 /host 또는 /join을 붙여 사용합니다.

예:
https://your-app.example/host
https://your-app.example/join

주의:
현재 데이터는 서버 메모리에 저장됩니다. 서버가 재시작되면 방/점수가 사라집니다.
