<img src="logo-512.png" alt="ER - Extension Repairer logo" width="160" align="right">

# ✚ ER - Extension Repairer

An emergency room for Bondage Club add-ons.

When a game update removes or changes something an add-on still uses, that add-on crashes or stops loading until its author updates it. ER puts a compatible stand-in back so your add-ons keep working in the meantime. When the game or the add-on catches up, ER's fix switches itself off.

- **Self-updating:** install once. Every game load fetches the newest fixes.
- **Safe on any version:** every fix checks the game first and only acts when something is actually missing or broken. On a game version with nothing to fix, ER does nothing.
- **Never talks to the server** and sends nothing anywhere.
- Type **`/er`** in a chat room (or open Preferences > Extensions) to see every fix, what ER thinks of it, and switch it.

## Install

**Userscript (recommended):** install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey, then open
**https://raw.githubusercontent.com/Proudkiller0015/extension-repairer/main/er.user.js** and press Install.

The userscript loads ER before your other add-ons. Some add-ons (for example ULTRAbc on R134) check the game while they start, so ER has to be there first to help them.

**Bookmark (no extension needed):** on the [install page](https://proudkiller0015.github.io/extension-repairer/), drag the **ER** button to your bookmarks bar. Or bookmark any page, edit the bookmark, name it `ER` and paste this as its address:

```
javascript:void(document.head.appendChild(document.createElement('script')).src='https://proudkiller0015.github.io/extension-repairer/er.js?v='+Date.now())
```

Open Bondage Club and click the bookmark before you log in (on a phone: type `ER` in the address bar and pick the bookmark). It always loads the newest ER. A bookmark can only run after the page has loaded, so click ER before your other add-on bookmarks. Add-ons that start by themselves (FUSAM, userscripts) start before you can click: most fixes still apply, but on the R134 beta the add-ons that crash while starting (ADCS, ULTRAbc, WCE) need ER loaded first, so for those use the userscript.

Install page: https://proudkiller0015.github.io/extension-repairer/

## Settings

Open them with **`/er`** in a chat room, or **Preferences > Extensions > ER - Extension Repairer**.

Every extension and every fix has a switch: **Auto** (the default), **On** or **Off**. On Auto, ER decides: a fix runs only when the game needs it. Each extension's fixes are tested with one version of that extension (Echo 1.136.5, ULTRAbc 6.4, WCE 6.3.20, BCX 1.1.23, LSCG 0.9.16). When that extension updates, ER pauses its fixes by itself, because the author may have fixed it, until ER is tested again. Next to each switch ER says what it thinks: running and why, not needed, paused (and why), or off. Use **On** to keep a paused fix running, or **Off** to stop one. Most switches act at once; fixes that start with the game need a reload.

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
| The chat squeezed the room or map off the screen | R134 lays the chat out next to the room in a flexible row without a minimum width, so one wide message or add-on element widens the chat until the room view is gone (normal and map rooms) | Everyone |
| BCX curses on crafted items looped | Since R133 the server echoes crafted items with only part of their craft data, so BCX curses see a change and "undo all changes" over and over. ER keeps the full craft on the player's own items | BCX |
| ULTRAbc drew its old profile sheet over the new one | R134 rebuilt the profile sheet as page elements; ULTRAbc still draws its canvas copy on top. While ULTRAbc runs, ER sends its old sheet to a hidden canvas | ULTRAbc |
| Add-on pictures never loaded | R134's image loader passes options to `CommonFetch`, which now refuses them with a `Request`; add-ons that redirect pictures (Echo) lost hair, eyes, sleeves and more | Echo, any add-on that redirects game files |
| Add-on items lost their default colours | R134 only reads colours set on each layer; the item-level `DefaultColor` add-ons use is ignored (about 420 Echo items came out uncoloured, and 淫纹 crashed while drawing) | Echo, any add-on with its own items |
| Map buttons vanished | R134 rebuilds the open room view's buttons when you come back to the room; LSCG skips the game when the view is already open (R133 did nothing there), so the map's arrows and editor stayed gone. ER rebuilds the view when nobody else did | LSCG |
| Items with options in their baseline could not change | R134 keeps the old option when merging; items with `BaselineProperty.TypeRecord` (Echo's 标志纹饰) never changed | Echo |
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
