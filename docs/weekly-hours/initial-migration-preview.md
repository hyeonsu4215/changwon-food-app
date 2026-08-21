# Initial Weekly Hours Migration Preview

> Historical preview record. These 112 rows were applied manually on 2026-08-16; the user app still uses the legacy hours reader.

## Summary

- Targets: 16 restaurants
- Rows: 112
- Day status: open 69, closed 15, unknown 28
- Break status: scheduled 11, none 15, unknown 86
- Metadata: source `legacy_migration`, note NULL, last_verified_at NULL
- Excluded: 13 restaurants, including C024

## C001 리코리코

BEFORE: open=10:00:00; close=20:40:00; break=(blank); closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 화 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 수 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 목 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 금 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 토 | open | 10:00:00 | 20:40:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C002 달인의찜닭

BEFORE: open=10:30:00; close=21:00:00; break=(blank); closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 화 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 수 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 목 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 금 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 토 | open | 10:30:00 | 21:00:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C003 엄마손

BEFORE: open=X; close=X; break=X; closed=X

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 화 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 수 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 목 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 금 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 토 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 일 | unknown | NULL | NULL | false | unknown | NULL | NULL |

## C007 봉구스 밥버거

BEFORE: open=10:20:00; close=20:00:00; break=X; closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 화 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 수 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 목 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 금 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 토 | open | 10:20:00 | 20:00:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C009 맘스터치

BEFORE: open=X; close=X; break=X; closed=X

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 화 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 수 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 목 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 금 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 토 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 일 | unknown | NULL | NULL | false | unknown | NULL | NULL |

## C010 따뜻한밥상

BEFORE: open=10:30:00; close=20:00:00; break=14:30-17:00; closed=토요일,일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:30:00 | 20:00:00 | false | scheduled | 14:30:00 | 17:00:00 |
| 화 | open | 10:30:00 | 20:00:00 | false | scheduled | 14:30:00 | 17:00:00 |
| 수 | open | 10:30:00 | 20:00:00 | false | scheduled | 14:30:00 | 17:00:00 |
| 목 | open | 10:30:00 | 20:00:00 | false | scheduled | 14:30:00 | 17:00:00 |
| 금 | open | 10:30:00 | 20:00:00 | false | scheduled | 14:30:00 | 17:00:00 |
| 토 | closed | NULL | NULL | false | none | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C011 소소소국수집

BEFORE: open=X; close=X; break=X; closed=X

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 화 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 수 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 목 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 금 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 토 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 일 | unknown | NULL | NULL | false | unknown | NULL | NULL |

## C013 쌈마이 닭쌈밥

BEFORE: open=10:00:00; close=20:00:00; break=X; closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 화 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 수 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 목 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 금 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 토 | open | 10:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C014 창대 비빔밥 뷔페

BEFORE: open=11:00:00; close=14:00:00; break=X; closed=토요일,일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 11:00:00 | 14:00:00 | false | unknown | NULL | NULL |
| 화 | open | 11:00:00 | 14:00:00 | false | unknown | NULL | NULL |
| 수 | open | 11:00:00 | 14:00:00 | false | unknown | NULL | NULL |
| 목 | open | 11:00:00 | 14:00:00 | false | unknown | NULL | NULL |
| 금 | open | 11:00:00 | 14:00:00 | false | unknown | NULL | NULL |
| 토 | closed | NULL | NULL | false | none | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C015 알촌

BEFORE: open=09:40:00; close=20:30:00; break=X; closed=토요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |
| 화 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |
| 수 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |
| 목 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |
| 금 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |
| 토 | closed | NULL | NULL | false | none | NULL | NULL |
| 일 | open | 09:40:00 | 20:30:00 | false | unknown | NULL | NULL |

## C017 이삭토스트

BEFORE: open=11:00:00; close=21:10:00; break=X; closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 화 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 수 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 목 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 금 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 토 | open | 11:00:00 | 21:10:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C019 밀밭이야기

BEFORE: open=X; close=X; break=X; closed=X

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 화 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 수 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 목 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 금 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 토 | unknown | NULL | NULL | false | unknown | NULL | NULL |
| 일 | unknown | NULL | NULL | false | unknown | NULL | NULL |

## C020 김밥일번지

BEFORE: open=09:00:00; close=20:00:00; break=X; closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 화 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 수 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 목 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 금 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 토 | open | 09:00:00 | 20:00:00 | false | unknown | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C022 차곡히

BEFORE: open=11:00:00; close=21:00:00; break=X; closed=토요일,일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 화 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 수 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 목 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 금 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 토 | closed | NULL | NULL | false | none | NULL | NULL |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |

## C023 레빗테이블

BEFORE: open=11:00:00; close=21:00:00; break=X; closed=토요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 화 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 수 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 목 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 금 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |
| 토 | closed | NULL | NULL | false | none | NULL | NULL |
| 일 | open | 11:00:00 | 21:00:00 | false | unknown | NULL | NULL |

## C027 호호돼지국밥

BEFORE: open=10:30:00; close=21:00:00; break=15:00-16:00; closed=일요일

| Day | Status | Open | Close | Next day | Break | Break start | Break end |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 월 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 화 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 수 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 목 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 금 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 토 | open | 10:30:00 | 21:00:00 | false | scheduled | 15:00:00 | 16:00:00 |
| 일 | closed | NULL | NULL | false | none | NULL | NULL |
