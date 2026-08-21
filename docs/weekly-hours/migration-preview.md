# Weekly Hours Migration Preview

> Historical preview record. The schema and this 112-row dataset were applied manually on 2026-08-16; the user app still uses the legacy hours reader.

## Baseline

- Live/static restaurant count: 29
- Live snapshot SHA-256: `21ff41fcdae654a8d2d303af889e4e9e8456a5cb7ac7c4b2bb9d626a4ea6de67`
- Live/static legacy-hours differences: 0
- Immediately safe weekly rows: 112
- Manual-review weekly rows not generated: 91
- Complete weekly target: 203

## Rules

- AUTO_SAFE creates seven rows and maps simple closed weekdays to `closed`.
- Empty or `X` break values become `break_status = unknown`, never `none`.
- UNKNOWN creates seven explicit unknown rows.
- CLOSED_UNKNOWN and special closure rules create no rows.
- `closes_next_day` is false for every current preview row.

## 29 Restaurants

| ID | Name | Legacy before | Classification / auto | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C001 | 리코리코 | open=10:00:00; close=20:40:00; break=(blank); closed=일요일 | AUTO_SAFE / YES | open 10:00:00-20:40:00; break unknown | open 10:00:00-20:40:00; break unknown | open 10:00:00-20:40:00; break unknown | open 10:00:00-20:40:00; break unknown | open 10:00:00-20:40:00; break unknown | open 10:00:00-20:40:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C002 | 달인의찜닭 | open=10:30:00; close=21:00:00; break=(blank); closed=일요일 | AUTO_SAFE / YES | open 10:30:00-21:00:00; break unknown | open 10:30:00-21:00:00; break unknown | open 10:30:00-21:00:00; break unknown | open 10:30:00-21:00:00; break unknown | open 10:30:00-21:00:00; break unknown | open 10:30:00-21:00:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C003 | 엄마손 | open=X; close=X; break=X; closed=X | UNKNOWN / YES | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | Legacy opening, closing, and closure information is unavailable; preserve seven unknown days. |
| C004 | 한솥도시락 | open=08:15:00; close=20:30:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C005 | 경대컵밥 | open=10:00:00; close=19:30:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C006 | 쇼부라멘 | open=09:00:00; close=16:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C007 | 봉구스 밥버거 | open=10:20:00; close=20:00:00; break=X; closed=일요일 | AUTO_SAFE / YES | open 10:20:00-20:00:00; break unknown | open 10:20:00-20:00:00; break unknown | open 10:20:00-20:00:00; break unknown | open 10:20:00-20:00:00; break unknown | open 10:20:00-20:00:00; break unknown | open 10:20:00-20:00:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C008 | 미스사이공 | open=09:00:00; close=19:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C009 | 맘스터치 | open=X; close=X; break=X; closed=X | UNKNOWN / YES | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | Legacy opening, closing, and closure information is unavailable; preserve seven unknown days. |
| C010 | 따뜻한밥상 | open=10:30:00; close=20:00:00; break=14:30-17:00; closed=토요일,일요일 | AUTO_SAFE / YES | open 10:30:00-20:00:00; break 14:30-17:00 | open 10:30:00-20:00:00; break 14:30-17:00 | open 10:30:00-20:00:00; break 14:30-17:00 | open 10:30:00-20:00:00; break 14:30-17:00 | open 10:30:00-20:00:00; break 14:30-17:00 | closed; time NULL; break none | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C011 | 소소소국수집 | open=X; close=X; break=X; closed=X | UNKNOWN / YES | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | Legacy opening, closing, and closure information is unavailable; preserve seven unknown days. |
| C012 | 김밥천국 | open=08:00:00; close=22:00:00; break=15:00-17:00; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C013 | 쌈마이 닭쌈밥 | open=10:00:00; close=20:00:00; break=X; closed=일요일 | AUTO_SAFE / YES | open 10:00:00-20:00:00; break unknown | open 10:00:00-20:00:00; break unknown | open 10:00:00-20:00:00; break unknown | open 10:00:00-20:00:00; break unknown | open 10:00:00-20:00:00; break unknown | open 10:00:00-20:00:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C014 | 창대 비빔밥 뷔페 | open=11:00:00; close=14:00:00; break=X; closed=토요일,일요일 | AUTO_SAFE / YES | open 11:00:00-14:00:00; break unknown | open 11:00:00-14:00:00; break unknown | open 11:00:00-14:00:00; break unknown | open 11:00:00-14:00:00; break unknown | open 11:00:00-14:00:00; break unknown | closed; time NULL; break none | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C015 | 알촌 | open=09:40:00; close=20:30:00; break=X; closed=토요일 | AUTO_SAFE / YES | open 09:40:00-20:30:00; break unknown | open 09:40:00-20:30:00; break unknown | open 09:40:00-20:30:00; break unknown | open 09:40:00-20:30:00; break unknown | open 09:40:00-20:30:00; break unknown | closed; time NULL; break none | open 09:40:00-20:30:00; break unknown | Opening, closing, and simple weekly closure values are explicit. |
| C016 | 롯데리아 | open=10:00:00; close=20:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C017 | 이삭토스트 | open=11:00:00; close=21:10:00; break=X; closed=일요일 | AUTO_SAFE / YES | open 11:00:00-21:10:00; break unknown | open 11:00:00-21:10:00; break unknown | open 11:00:00-21:10:00; break unknown | open 11:00:00-21:10:00; break unknown | open 11:00:00-21:10:00; break unknown | open 11:00:00-21:10:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C018 | 뼈따구 | open=10:00:00; close=21:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C019 | 밀밭이야기 | open=X; close=X; break=X; closed=X | UNKNOWN / YES | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | unknown; time NULL; break unknown | Legacy opening, closing, and closure information is unavailable; preserve seven unknown days. |
| C020 | 김밥일번지 | open=09:00:00; close=20:00:00; break=X; closed=일요일 | AUTO_SAFE / YES | open 09:00:00-20:00:00; break unknown | open 09:00:00-20:00:00; break unknown | open 09:00:00-20:00:00; break unknown | open 09:00:00-20:00:00; break unknown | open 09:00:00-20:00:00; break unknown | open 09:00:00-20:00:00; break unknown | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C021 | 팔팔마라탕 | open=10:50:00; close=21:30:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C022 | 차곡히 | open=11:00:00; close=21:00:00; break=X; closed=토요일,일요일 | AUTO_SAFE / YES | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | closed; time NULL; break none | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C023 | 레빗테이블 | open=11:00:00; close=21:00:00; break=X; closed=토요일 | AUTO_SAFE / YES | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | open 11:00:00-21:00:00; break unknown | closed; time NULL; break none | open 11:00:00-21:00:00; break unknown | Opening, closing, and simple weekly closure values are explicit. |
| C024 | 고가밀면 | open=10:50:00; close=15:30:00; break=X; closed=2,4번째 일요일 | MANUAL_REVIEW_CLOSED_RULE / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | The recurring monthly closure cannot be represented by weekly rows alone. |
| C025 | 가야밀면 | open=11:00:00; close=19:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C026 | 유가네 닭갈비 | open=11:00:00; close=22:00:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C027 | 호호돼지국밥 | open=10:30:00; close=21:00:00; break=15:00-16:00; closed=일요일 | AUTO_SAFE / YES | open 10:30:00-21:00:00; break 15:00-16:00 | open 10:30:00-21:00:00; break 15:00-16:00 | open 10:30:00-21:00:00; break 15:00-16:00 | open 10:30:00-21:00:00; break 15:00-16:00 | open 10:30:00-21:00:00; break 15:00-16:00 | open 10:30:00-21:00:00; break 15:00-16:00 | closed; time NULL; break none | Opening, closing, and simple weekly closure values are explicit. |
| C028 | 장독짜장 | open=10:30:00; close=20:20:00; break=X; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |
| C029 | 돌솥밥수 | open=11:00:00; close=20:30:00; break=15:00-17:00; closed=X | MANUAL_REVIEW_CLOSED_UNKNOWN / NO | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | NO ROW | Opening hours are known but weekly closure days are unverified; create no rows. |

## C024

C024 remains on the legacy reader. Weekly rows are not generated because `2,4번째 일요일` cannot be represented as every-Sunday closure. A future recurring-closure design would add two rows for ISO weekday 7 and weeks 2 and 4.

## 3C-2 Initial Migration Package

The initial migration contains only the 12 AUTO_SAFE and 4 UNKNOWN restaurants: 16 restaurants, 112 rows, and seven ISO weekdays per restaurant. All 13 manual-review restaurants, including C024, remain at zero rows.

The field-level BEFORE to AFTER review is in `initial-migration-preview.md`; the deterministic 112-row dataset is in `initial-migration-preview.json`.

## Row Counts

- AUTO_SAFE: 12 x 7 = 84 rows
- UNKNOWN: 4 x 7 = 28 rows
- Immediately safe total: 112 rows
- CLOSED_UNKNOWN: 12 x 7 = 84 rows after manual verification
- C024: 7 weekly rows plus 2 future recurring rows after recurring support
- Complete weekly table: 29 x 7 = 203 rows
