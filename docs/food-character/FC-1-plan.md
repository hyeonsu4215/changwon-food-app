# Primary Food Character FC-1 운영 계획

## FC-1 경계

FC-1은 관리자 UI의 비활성 미리보기와 100개 메뉴 검토 초안까지만 준비한다. 사용자 앱 추천 로직, `tags` 판정, Discovery 결과, Supabase 스키마와 데이터는 변경하지 않는다.

Secondary Trait은 Primary가 안정된 뒤 별도로 검토한다. `tags`는 혼밥, 데이트, 시험기간, 해장, 가성비 같은 상황·속성 데이터로 유지하며 Food Character와 혼용하지 않는다.

## 현재 구조

- 실제 테이블: `public.menus`
- 현재 원격 행 수: anon 읽기 기준 0개
- 관리자 조회: `select("*").order("name")`
- 관리자 저장: `upsert(payload, { onConflict: "id" })`
- JS 모델은 camelCase, DB payload는 snake_case로 `admin.js`에서 직접 변환한다.
- 원격 컬럼 확인 결과 `food_character`, `primary_food_character`, `meal_type`, `food_traits`, Secondary Trait 계열 컬럼은 없다.
- 저장소에는 SQL schema, migration, CHECK constraint, enum, RLS 정의 파일이 없다.
- `data.js`는 가게 29곳, 메뉴 100개이며 모든 메뉴가 동일한 18개 필드를 가진다. Food Character 전용 필드는 없다.

## 권장 Primary 구조

권장 매핑은 DB `food_character` ↔ 관리자 모델 `foodCharacter`다. Primary부터 안정화하고 Secondary Trait은 같은 migration에 묶지 않는다.

### A. TEXT + 애플리케이션 validation

장점은 스키마 변경이 단순하고 허용값 확장이 빠르다는 점이다. 단점은 관리자 외 경로에서 오타나 미지원 값이 들어갈 수 있고 데이터베이스가 무결성을 보장하지 못한다는 점이다.

### B. TEXT + CHECK constraint

장점은 모든 쓰기 경로에서 정확히 5개 값 또는 `NULL`만 허용한다는 점이다. 단점은 값 추가 시 migration이 필요하다는 점이다.

권장안은 nullable `TEXT`와 CHECK constraint의 조합이다. 허용값은 `rice-meal`, `noodle-special`, `hot-soup`, `quick-snack`, `main-dish`다. FC-2에서는 컬럼 추가와 CHECK 적용을 하나의 검토 가능한 migration 파일로 만들되, 실행은 별도 승인을 받는다.

향후 Secondary Trait 후보는 nullable `food_traits TEXT[]`와 관리자 모델 `foodTraits: []`다. FC-2 필수 범위에는 넣지 않는다.

## 백업 설계

FC-2의 어떠한 schema/data write보다 먼저 다음 파일을 같은 timestamp 디렉터리에 만든다.

- `menus-before-food-character.json`
- `menus-before-food-character.csv`
- `stores-before-food-character.json`
- `schema-before-food-character.sql`
- `migration-preview.json`
- `migration-preview.csv`
- `migration-approved.csv` 또는 `migration-approved.json`
- `backup-manifest.json`

manifest에는 백업 시각, Supabase project identifier, 가게 수, 메뉴 수, `origin/main` SHA, feature SHA, 작업 목적, 각 파일의 SHA-256을 기록한다. export는 service role 또는 대시보드 권한이 필요한 별도 운영 절차이며 FC-1에서는 실행하지 않는다.

## FC-2 migration 순서

1. Supabase schema와 `stores`, `menus`를 읽기 전용 export한다.
2. FC-1 preview 100개를 사람이 모두 검토하고 승인본을 만든다.
3. 승인본의 menu ID가 DB와 1:1인지 확인하고 누락·추가·중복 diff를 만든다.
4. 사용자 승인 후 nullable `food_character` 컬럼과 CHECK constraint만 먼저 추가한다.
5. DB 재조회로 컬럼 존재와 기존 메뉴 무변경을 확인한다.
6. 관리자 disabled UI를 활성화하고 camelCase↔snake_case CRUD 매핑을 연결한다.
7. 별도 승인 후 승인된 100개 값을 ID 기준으로 update한다.
8. 성공 ID와 실패 ID를 항목별 로그로 남기고 재조회 결과를 승인본과 비교한다.
9. 사용자 앱 연동은 별도의 앱 운영 개선 feature에서 수행한다.

컬럼 생성과 100개 데이터 입력은 반드시 분리 가능한 단계로 유지한다. 스키마만 추가된 상태에서 `NULL`은 기존 추천 동작에 영향을 주지 않아야 한다.

## Rollback 계획

### 관리자 코드

FC-2 feature 변경을 되돌리고 disabled preview 또는 기존 관리자 버전으로 복귀한다. 사용자 앱 feature와 함께 되돌리지 않는다.

### 데이터

승인본 update 전에 각 menu ID의 기존 `food_character` 값을 백업한다. 실패 시 전체 초기화 대신 성공 ID 목록만 대상으로 이전 값을 복구한다.

### 스키마

문제가 생기면 먼저 모든 코드에서 컬럼 읽기·쓰기를 중단하고 데이터를 보존한다. `DROP COLUMN`은 데이터 손실 작업이므로 자동화하지 않으며 별도 승인과 추가 백업 없이는 실행하지 않는다.

### 부분 migration

각 update 결과에 `menu_id`, 이전 값, 요청 값, 결과, 처리 시각을 기록한다. 어느 ID까지 성공했는지 추적하고 실패 행만 재시도하거나 항목별 복구한다.

## Preview 운영 규칙

`scripts/preview-food-character-migration.js`는 `data.js`만 읽고 JSON·CSV를 만든다. 메뉴명, category, 필요한 경우 가게명만 초안 근거로 사용한다. `tags`는 검토 자료로 출력하지만 분류 입력에는 사용하지 않는다.

모든 행의 초기 `review_status`는 `needs-review`다. `suggested_food_character`는 자동 확정값이 아니며 DB update 입력으로 직접 사용하면 안 된다. 승인본은 preview 원본을 덮어쓰지 않고 별도 파일로 만든다.
