# 묵찌 PICK! 개인정보 보관기간 운영 절차

## 적용 정책

- 이용 현황 기록: `analytics_events.server_received_at` 기준 2년 보관
- 정보 제보: `done` 또는 `rejected`로 처리가 종료된 `completed_at` 기준 6개월 보관
- 정확한 경계 시각은 삭제하지 않고, 기준 시각보다 오래된 행만 파기한다.
- 자동 삭제 작업은 사용하지 않는다.

## 정보 제보 완료 시각

`info_reports.completed_at`은 DB 트리거가 관리한다.

- 트리거는 `BEFORE INSERT OR UPDATE`에서 실행된다.
- 사용자 앱의 공식 신규 제보 경로는 `status = pending`을 명시하며, DB 기본값도 `pending`이다. 관리자 앱에는 종료 상태로 신규 제보를 INSERT하는 경로가 없다.
- 운영자가 별도 SQL 등으로 `done` 또는 `rejected` 상태를 직접 INSERT하더라도 트리거가 현재 서버 시각을 기록한다.
- `pending` 또는 `checking`에서 `done` 또는 `rejected`로 바뀌면 현재 서버 시각을 기록한다.
- 이미 `done` 또는 `rejected`인 제보를 수정해도 기존 완료 시각을 유지한다.
- `done` 또는 `rejected`에서 `pending` 또는 `checking`으로 돌아가면 완료 시각을 비운다.
- 다시 처리를 종료하면 새로운 완료 시각을 기록한다.
- migration 이전 제보는 완료 시각을 추정하지 않는다. 기존 `rejected` 행도 `completed_at = NULL`로 남는다.

### 기존 종료 제보 처리

- migration 적용 후 기존 `done` 또는 `rejected` 행 중 `completed_at IS NULL`인 목록을 읽기 전용으로 확인한다.
- 이 행들은 완료 시각이 없으므로 6개월 파기 대상에 자동으로 포함되지 않는다.
- `created_at`이나 `updated_at`을 완료 시각으로 자동 간주하지 않는다.
- 완료 시각을 신뢰할 수 있는 별도 운영 근거가 있을 때만 건별로 판단하고, 실제 `completed_at` 수정은 별도 사용자 승인을 받은 뒤 진행한다.
- 근거가 없으면 임의 날짜를 입력하지 않는다. 이번 구현에서는 기존 행을 UPDATE하지 않는다.

## A. 이용 현황 기록 2년 파기

1. **Preview**: `privacy-retention-preview-readonly.sql`을 실행해 대상 건수와 가장 오래된·최근 대상 시각을 기록한다.
2. **Backup**: `privacy-retention-backup-readonly.sql`의 Analytics SELECT만 실행하고 결과를 repo 밖의 접근 제한 폴더로 내보낸다.
3. **Manifest**: 내보낸 파일의 생성 시각, 행 수, SHA-256, Preview 기준 시각을 기록한다.
4. **재확인**: 삭제 직전에 Preview를 다시 실행한다. 건수가 달라지면 중단하고 백업부터 다시 한다.
5. **승인**: 담당 사용자에게 정확한 건수와 날짜 범위를 보여주고 별도 삭제 승인을 받는다.
6. **Delete**: Production 프로젝트의 Supabase SQL Editor에서 `privacy-retention-delete-transaction.sql`의 예상 건수와 확인 문자열을 승인 내용에 맞게 준비한 뒤 한 번만 실행한다.
7. **검증**: Preview를 다시 실행해 2년 초과 기록이 0건인지 확인한다.

## B. 정보 제보 6개월 파기

1. **Preview**: 대상 제보의 ID, 상태, `completed_at`을 확인한다.
2. **Backup**: 백업 SQL의 제보 SELECT 결과를 repo 밖의 접근 제한 폴더로 내보낸다. 연락 메모와 제보 내용이 포함되므로 공개 폴더에 두지 않는다.
3. **Manifest**: 파일 생성 시각, 행 수, SHA-256, 대상 ID 목록을 기록한다.
4. **재확인**: 삭제 직전 Preview의 ID 목록이 백업 목록과 완전히 같은지 확인한다.
5. **승인**: 대상 ID 전체를 제시하고 별도 삭제 승인을 받는다.
6. **Delete**: 삭제 transaction에 승인된 ID 전체와 확인 문자열을 입력해 한 번만 실행한다.
7. **검증**: 같은 조건의 대상이 0건인지 확인한다.

## 백업 보관

- 백업은 복구 확인을 위한 임시 자료로만 사용한다.
- repo, Git, 공유 드라이브, 메신저에 올리지 않는다.
- 삭제 검증 및 복구 필요성 확인이 끝나면 백업과 manifest를 즉시 파기하고, 늦어도 7일 이내에 파기한다.
- 백업 파기 여부도 운영 기록에 남긴다.

## 실수 방지 장치

- 삭제 transaction은 기본값에서 무조건 실패한다.
- Supabase SQL Editor의 신뢰된 `postgres` 운영 세션 또는 앱 관리자 권한, 예상 Analytics 건수, 제보 ID 전체, 확인 문자열이 모두 맞아야 진행된다.
- 대상은 transaction 안에서 서버가 다시 계산한다.
- Preview와 실제 대상이 다르면 전체 transaction이 rollback된다.
- 삭제 후에도 만료 대상이 남거나 삭제 건수가 다르면 전체 transaction이 rollback된다.

## 개인정보 삭제 요청 운영 초안

문의 이메일은 `mukjji26@naver.com`이다. 사용자가 현재 익명 사용자 식별값을 제공한 경우 다음 순서로 처리한다.

현재 운영 DB 관계는 다음과 같다.

- 후기: `public.menu_reviews.user_id uuid NOT NULL`이 `auth.users.id`를 참조하며 `ON DELETE CASCADE`이다. 계정 삭제 전에는 UID로 직접 조회할 수 있다.
- 입맛 투표: `public.menu_taste_votes.user_id uuid NOT NULL`이 `auth.users.id`를 참조하며 `ON DELETE CASCADE`이다. 계정 삭제 전에는 UID로 직접 조회할 수 있다.
- 정보 제보: `public.info_reports.user_id uuid NULL`이 `auth.users.id`를 참조하며 `ON DELETE SET NULL`이다. 계정 삭제 전에는 UID로 직접 조회할 수 있지만, 계정 삭제 후에는 해당 제보를 UID로 연결할 수 없다.
- 익명 사용자 계정: Supabase Auth의 `auth.users` 테이블에서 `id uuid`로 식별한다.
- Analytics: `analytics_events`에는 익명 사용자 UID 컬럼이 없고 계정과 연결되지 않는다. `session_id`는 Auth UID가 아니다. 따라서 UID 기반 삭제 요청에 사용할 수 없다.

1. 식별값으로 `menu_reviews`, `menu_taste_votes`, `info_reports`의 대상 건수와 ID를 읽기 전용으로 확인한다.
2. 요청자에게 삭제 범위와 Analytics는 계정 ID로 연결할 수 없다는 점을 안내한다.
3. 대상만 별도로 백업하고 별도 삭제 승인을 기록한다.
4. `info_reports`는 익명 계정을 먼저 삭제하면 `user_id`가 `NULL`이 되므로 제보를 먼저 처리한다.
5. 후기와 입맛 투표를 처리한 뒤 익명 계정을 삭제한다. FK `CASCADE`에만 의존하지 말고 삭제 전후 건수를 확인한다.
6. 처리 결과와 임시 백업 파기 예정일을 요청자에게 안내한다.

현재 사용자 앱에는 익명 사용자 식별값을 보여주거나 삭제 요청번호를 만드는 기능이 없다. 이 절차는 식별값이 별도로 확보된 경우에만 사용할 수 있다. Analytics는 별도 세션 ID만 저장하므로 익명 계정 ID로 개별 기록을 찾거나 삭제할 수 없다.
