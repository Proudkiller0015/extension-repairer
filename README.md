# ✚ ER - Extension Repairer

An emergency room for Bondage Club add-ons.

When a game update removes or changes something an add-on still uses, that add-on crashes or stops loading until its author updates it. ER puts a compatible stand-in back so your add-ons keep working in the meantime. When the game or the add-on catches up, ER's fix switches itself off.

- **Self-updating:** install once. Every game load fetches the newest fixes.
- **Safe on any version:** every fix checks the game first and only acts when something is actually missing or broken. On a game version with nothing to fix, ER does nothing.
- **Never talks to the server** and sends nothing anywhere.
- Type **`/er`** in a chat room to see the chart: which fixes are running, why, and for which add-ons.

## Install

**Userscript (recommended):** install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey, then open
**https://raw.githubusercontent.com/Proudkiller0015/extension-repairer/main/er.user.js** and press Install.

The userscript loads ER before your other add-ons. Some add-ons (for example ULTRAbc on R134) check the game while they start, so ER has to be there first to help them.

Install page: https://proudkiller0015.github.io/extension-repairer/

## What it treats (R134 beta)

| Fix | Why it broke | Add-ons it helps |
|---|---|---|
| `ChatRoomSpace` / `ChatRoomGame` | Removed; the space and game now live in `ChatRoomData` and the lobby settings | ADCS (crash in rooms), WCE, LSCG, MBS, BCT, EBC, MPA, Themed, ABCL, CATS, AFC, FCM, GGC, Echo, NotifyPlus |
| `InformationSheetSecondScreen` | The profile sheet was rebuilt without its second page | ULTRAbc (stopped loading), AFC, FCM |
| `OnlineProfileMode` / `OnlineProfileText*` | Moved into the `OnlineProfile` object | WCE |
| `ChatAdmin*Mode*` / `ChatBlockItem*` | The room settings screen was rebuilt | BC+, KikiLink, BCX |
| `Controller*` | Gamepad support was removed | BCT, Themed, ULTRAbc, EBCH, MoonCEBC |
| `InfiltrationMission` / `Target` / `Difficulty` | Merged into `InfiltrationMissionState` | ULTRAbc (Pandora mission tools) |
| Modular items only saved their first option | Game bug in the R134 beta (fix waiting as game MR !6947) | Everyone: Bar Stool decal, Hypnotic Visor, Echo items |
| `PreferenceArousalIsActive()` | Now needs a character; old calls crashed | WCE |
| `ExtendedItemDrawHeader(X, Y, Item)` and the `DialogFocusItem` defaults | Argument order changed | Older item add-ons |
| `CommonDebounce(func)` / `CommonThrottle(func)` | Now `(interval, func)` | Older add-ons |

Some things ER cannot put back: screens R134 rebuilt from scratch (room settings, profile sheet) no longer have the old drawing code, so add-on patches that edited that drawing code (BCX room settings, BC+ profile buttons) need their authors.

## How it works

ER waits for the game's scripts, then:

1. **Stand-ins:** a removed global is only added if the game does not have it. Stand-ins read and write the game's new state, so for example `ChatRoomSpace` always shows the current room's space.
2. **Argument fixes:** through [ModSDK](https://github.com/Jomshir98/bondage-club-mod-sdk) hooks (so other add-ons' hooks keep working), old calling styles are translated to the new ones. Only on R134 and later.
3. **Game bug fixes:** each one first tests whether the bug is there and only applies when it is.

`window.ER.chart()` lists what every fix found. `window.ER.standIns()` lists the names ER put back.

## For add-on authors

ER is a stopgap. Please update your add-on for the new game version anyway. The chart in `/er` tells your players which change hit you. ER registers with ModSDK as `ER`.

## Testing

`npm install`, then `node test.js` (set `CHROME` to your Chrome path if it is not the Windows default) loads the R134 beta and live R133 in headless Chrome. It checks that every fix applies on the beta and that nothing changes on live. `tools/` has the scripts used to find the breakages: `diff-globals.js` compares two game builds, `scan.js` searches every FUSAM add-on for removed names, and `survey.js` loads each add-on as a fake logged-in player and records its errors.

## License

MIT. Made by SlimeQueenSamantha.
