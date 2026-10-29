# Kakao Maps / To J

## Runtime setup

Set `KAKAO_MAP_JAVASCRIPT_KEY` in hosted Sites environment settings, then deploy. This is Kakao's **JavaScript** key, intentionally sent to authenticated browsers; never put a REST API key or Admin key here. Keep the actual value out of Git, logs and docs. Local development can use the same variable in an ignored `.dev.vars` file.

In Kakao Developers, turn on Kakao Maps and register the production origin and `http://localhost:3000` under the key's **JavaScript SDK domains**. General product web domains are a different setting. No login/OAuth redirect URI is needed for this integration. Changing the production domain requires updating the allowlist.

As of 2026-09-19, the official July 21, 2026 policy gives free quota to only the developer account's first activated Maps app. Subsequent apps and exceeding free quota require paid settings. To J does not enable billing or create a wallet. Monitor quota in Kakao Developers before launch.

## User flow and data

- Enter a location and explicitly press **장소 검색**. The SDK loads only on search or **지도 보기**, not on page load or every keystroke. Only the search text is sent to Kakao; To J does not request device geolocation or send event titles/notes.
- Choose a result by name and address. Search returns five results per page; previous/next remain available. Search failures keep manual input and the external Kakao search link usable.
- Save `place: {provider: 'kakao', id, name, address, latitude, longitude}` with the event. D1's nullable `events.place_json` stores this selection, not search history. Existing events remain free text until the user selects a place.
- Editing the location text removes the selected coordinates. An older client that omits `place` keeps it only if its location still matches. Explicit `place: null` clears it. Malformed coordinates, IDs or mismatched names are rejected server-side.
- Details show an expandable map and marker, external map and destination-only directions. The user chooses their origin in Kakao Maps. Free-text locations have a search link, not a fabricated coordinate or route.
- Saved coordinates are used for maps and routes only. Weather lookup was removed on 2026-09-20.

`/api/maps/config` requires the same identity as other APIs. It returns only the JavaScript key with `private, no-store`. Event APIs retain owner checks. Kakao SDK results are rendered as text, never HTML. Outbound links are generated on a fixed HTTPS domain from validated numeric IDs or encoded search text; arbitrary provider URLs are not stored/opened.

## Verification / mobile boundary

`node scripts/test-kakao-maps.mjs` tests the contract, encoded links, SDK adapter with mocks, isolated built Worker CRUD/ownership, config allowlisting and retirement of the weather endpoint. Build before running the Worker tests. These tests do not replace a real-key browser test of domain/activation/quota and visible map tiles. A 200 SDK bootstrap response alone does not prove every downstream service or map tile works.

Place data and HTTPS directions links are usable by future mobile clients. Actual native SDK setup, native app keys and native geofencing are not implemented here.

Official references:
- https://apis.map.kakao.com/web/guide/
- https://apis.map.kakao.com/web/sample/keywordBasic/
- https://developers.kakao.com/docs/ko/kakaomap/common
- https://developers.kakao.com/docs/ko/app-setting/app
