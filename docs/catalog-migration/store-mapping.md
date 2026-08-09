# Store Mapping

> PREVIEW ONLY. No database write has been performed.

The application table name is `restaurants`; this report uses "stores" only as a domain label. All 21 target columns were accepted by an anon GET select. OpenAPI constraint metadata required service-role access and was not requested. Required/nullable, primary key, and foreign key constraints therefore remain unconfirmed. `id` as the conflict target and `menus.restaurant_id` as the relationship are application-level inferences from existing code, not catalog metadata claims.

| data.js | restaurants | Type | Transform |
| --- | --- | --- | --- |
| id | id | string | No transform |
| name | name | string | No transform |
| area | area | string | The app uses area for the requested region concept |
| address | address | string | No transform |
| lat | lat | number | Number(value || 0) |
| lng | lng | number | Number(value || 0) |
| phone | phone | string | Empty string fallback |
| openTime | open_time | string | Empty string fallback |
| closeTime | close_time | string | Empty string fallback |
| breakTime | break_time | string | Empty string fallback |
| closedDays | closed_days | string | Empty string fallback |
| takeout | takeout | boolean | Boolean(value) |
| delivery | delivery | boolean | Boolean(value) |
| alone | alone | boolean | Boolean(value) |
| group | group_available | boolean | Boolean(value) |
| seats | seats | number | Number(value || 0) |
| reviewCount | review_count | number | Number(value || 0) |
| source | source | string | Empty string fallback |
| lastChecked | last_checked | timestamp | Null when empty |
| memo | memo | string | Empty string fallback |
| (implicit) | active | boolean | True unless explicitly false |
