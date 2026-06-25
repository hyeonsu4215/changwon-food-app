# GitHub 업로드 안내 - 날씨 캐시 수정

## 목적

날씨 정보가 2026-06-24 16:37 데이터로 고정되어 보이던 문제를 해결하는 수정입니다.

원인은 Vercel이 `/api/weather` 응답을 캐시해서, 서버 함수가 새로 실행되지 않았던 것입니다.
이번 수정은 Vercel/CDN 응답 캐시를 끄고, Supabase의 1시간 날씨 캐시만 사용하도록 바꿉니다.

## 올릴 파일

이 폴더 안의 파일을 GitHub 저장소의 같은 위치에 덮어쓰기 하면 됩니다.

```text
api/weather.js
```

## GitHub에서 올리는 방법

1. GitHub 저장소로 들어갑니다.
2. `api` 폴더를 엽니다.
3. 기존 `weather.js` 파일을 엽니다.
4. 오른쪽 위 연필 모양 또는 Edit 버튼을 누릅니다.
5. 이 폴더의 `api/weather.js` 내용을 전체 복사해서 붙여넣습니다.
6. Commit changes를 누릅니다.
7. Vercel이 자동 재배포될 때까지 기다립니다.

## 배포 후 확인

브라우저에서 아래 주소를 열어 확인합니다.

```text
https://changwon-food-app.vercel.app/api/weather
```

응답 헤더에서 `X-Vercel-Cache: HIT`가 계속 뜨지 않아야 합니다.
날씨 데이터의 `fetchedAt`이 오래된 날짜로 고정되지 않으면 정상입니다.

## 수정된 핵심 코드

```js
res.setHeader("Cache-Control", "no-store, max-age=0");
res.setHeader("CDN-Cache-Control", "no-store");
res.setHeader("Vercel-CDN-Cache-Control", "no-store");
```
