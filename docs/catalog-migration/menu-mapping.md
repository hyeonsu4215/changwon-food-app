# Menu Mapping

> PREVIEW ONLY. No database write has been performed.

All 18 current target columns were accepted by an anon GET select. The table has zero rows, so value-level runtime shape cannot be sampled. Required/nullable, primary key, and foreign key constraints remain unconfirmed because OpenAPI metadata is not available to anon. `food_character` is intentionally absent from the current mapping and appears only in the combined preview after separate schema approval.

| data.js | menus | Type | Transform |
| --- | --- | --- | --- |
| id | id | string | No transform |
| restaurantId | restaurant_id | string | Application-level store reference |
| restaurantName | restaurant_name | string | Resolved from the mapped store when possible |
| name | name | string | No transform |
| category | category | string | 기타 fallback |
| price | price | number | Number(value || 0) |
| spicy | spicy | number | Number(value || 0), validated 0-5 |
| salty | salty | number | Number(value || 0), validated 0-5 |
| sweet | sweet | number | Number(value || 0), validated 0-5 |
| portion | portion | number | Number(value || 0), validated 0-5 |
| value | value | number | Number(value || 0), validated 0-5 |
| speed | speed | number | Number(value || 0), validated 0-5 |
| signature | signature | boolean | Boolean(value) |
| available | available | boolean | True unless explicitly false |
| tags | tags | array | Copied array; non-array is rejected by validation |
| source | source | string | Empty string fallback |
| lastChecked | last_checked | timestamp | Null when empty |
| recommendNote | recommend_note | string | Empty string fallback |
