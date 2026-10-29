# Saved journey and route recommendations

## Product flow

1. Choose an event's place from Kakao search. This remains its destination, displayed in the calendar/detail and used for map and route lookup.
2. In the event form, enable **이동 경로도 계획하기**. Choose an origin, optionally add up to five intermediate places, and select 자동차 / 대중교통 / 도보.
3. Reorder/delete intermediate places explicitly. **방문 순서 제안 적용** exhaustively checks up to 5! orders with Haversine distance, fixing the origin and destination. This only changes the draft; saving commits it. It is prominently labeled a geometric suggestion, not a road/time optimum, and does not account for appointment times.
4. Save the event, then use **추천 경로 조회**. The chosen provider supplies actual route geometry and estimated time. Switching travel mode clears old results; mode changes in details are previews, while the event editor saves the default mode.

## Provider behavior

- Car: `GET https://apis-navi.kakaomobility.com/v1/directions`, `priority=RECOMMEND`, `summary=false`, ordered pipe-separated waypoints. This is Kakao's recommended route for the saved order, not automatic stop-order optimization.
- Walk: `GET https://dapi.kakao.com/v2/routing/walk`, `route_mode=SHORTEST`, paired `via_x`/`via_y`, WGS84 output. Whole route with up to five waypoints.
- Transit: `GET https://dapi.kakao.com/v2/routing/publictraffic` per adjacent pair. Choose the lowest `totalTime` among returned candidates for each leg. Transit has no waypoint request parameter. Sum of current per-leg estimates excludes visits and does not guarantee later connections, timetables or last services.
- Car and walk also show current estimates, not a forecast for the event date. Durations are seconds, distances meters. Provider `[longitude,latitude]` points are swapped only when constructing SDK `LatLng`.
- Show markers only until the route is successfully returned. Never draw straight lines as a substitute for actual paths. Partial route failure hides the entire aggregate rather than showing a misleading total.
- External Kakao links remain available on missing key, denied API, no route, quota or network failure. Transit opens each leg separately for multi-stop journeys. Provider-returned landing URLs are not trusted or opened; links are constructed from validated saved coordinates on a fixed HTTPS host.

## Storage and safety

`events.travel_plan_json` contains `{origin: KakaoPlace, waypoints: KakaoPlace[], mode}`; destination is `events.place_json`. This is durable D1 state, not browser storage. Older clients preserve the plan only while the complete destination still matches. Explicit null clears it. Invalid/oversized plans and a plan without a selected destination fail input validation.

`POST /api/events/:id/route` takes `{mode, planFingerprint}`. Authenticate and read the owned saved event; never trust arbitrary client destinations. Check the snapshot fingerprint before quota/network calls so an older tab cannot display a newly edited route under stale place labels. Client requests are aborted/ignored on unmount or mode changes. Route results are not persisted and responses are `private, no-store`.

`KAKAO_REST_API_KEY` is a **secret** Sites environment value, distinct from the intentionally public Maps JavaScript key. It never enters the config API, client bundle, D1 or provider URL. Only coordinates go to providers, not user identity, event title or notes. Do not enable paid products, increase quotas or create wallets automatically. The user's ignored `.dev.vars` may contain local secrets; do not commit or print it.

`route_request_limits` implements an atomic owner/KST-day counter: 30 calculations/day, at least 10 seconds apart. A calculation performs at most six provider requests, no automatic retries. Requests share a 15-second abort deadline, refuse redirects (manual redirect mode, non-2xx rejected), limit response body to 3 MB and reject invalid/incomplete/oversized geometry. No persistent caching of provider route responses is introduced.

## Verification

- `node scripts/test-routing.mjs`: pure contract/ordering/parsing tests and built Worker with isolated D1 and mocked providers. Includes 3 modes, ownership, concurrent quota guard, daily reset, stale-plan rejection, error sanitization and old-client behavior.
- `node --env-file=.dev.vars scripts/test-routing.mjs --live`: explicit real-provider smoke test using public sample-area coordinates, with one intermediate place. Requires the operator's REST key; never logs it or writes real event data.
- Real API checks on 2026-09-19 returned valid geometry, two legs, distance and time for all three modes. Browser-visible map rendering was not tested in this task.

Sources:
- https://developers.kakaomobility.com/guide/navi-api/directions
- https://developers.kakao.com/docs/ko/kakaomap/rest-api
- https://apis.map.kakao.com/web/guide/#routeurl
- https://developers.kakao.com/docs/ko/getting-started/quota
