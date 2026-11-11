## Problem

On the R134 beta (`R134Beta1`), Echo's Clothing Extension (服装拓展 1.136.5, stable and beta) loads and registers its items, but:

1. **Most Echo pictures never load.** Hair, eyes, wide sleeves, capes and every other picture served from the jsDelivr CDN stay invisible. A look exported on R133 (hair `新前发_Luzi`/`新后发_Luzi`/`额外头发_Luzi`, eyes `左眼_Luzi`/`右眼_Luzi`, sleeves `长袖子_Luzi/广袖`, cape `披肩短`) draws on R134 as a bare body with only the vanilla clothes.
2. **About 420 items lose their default colours.** They come out as plain `Default`. Some then crash while drawing, e.g. `淫纹` (ItemPelvis, ItemTorso, ItemTorso2): `Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('Default') could not be parsed as a color`.
3. **Options on items with a baseline `TypeRecord` can't be changed.** `标志纹饰` (BodyMarkings and BodyMarkings2_Luzi) stays at its baseline whatever is picked.
4. **Modular options reset.** On 169 of 571 items with options, only the first module keeps its value. This is a game bug, not Echo's (details below).

## Cause

### 1. Pictures: `CommonFetch` with a `Request` and options

R134 rebuilt image loading (`Scripts/ImageCache.js`). Every picture is now fetched with

```js
CommonFetch(this.url, { headers: [["accept", "image/*"]] })
```

and R134's `CommonFetch` refuses a `Request` object together with options:

```js
if (reqOrUrl instanceof Request) {
	if (options) throw new Error("can't use options and pass a request object");
```

`@sugarch/bc-asset-manager` hooks `CommonFetch` (`ImgMappingOnce.CommonFetch.cors`, priority 0). For cross-origin URLs it replaces `args[0]` with `new Request(url, { mode: "cors", credentials: "omit", headers })` and passes `args[1]` on unchanged. On R134 that is a `Request` plus options, so `CommonFetch` throws before any network request. The image is marked `failed`, and the console shows `Failed to load image https://cdn.jsdelivr.net/gh/SugarChain-Studio/echo-clothing-ext@.../...png [object Object]` (the object's `err` is the error above). The URL mapping itself is fine: `GLDrawImage` receives the correct jsDelivr URL, and the same URL loads through `GLDrawImageCache.get()` when the hook isn't involved.

### 2. Default colours: asset-level `DefaultColor` is ignored

R133 built `Asset.DefaultColor` from the asset definition (`AssetParseDefaultColor(A.ColorableLayerCount, Group.DefaultColor, AssetDef.DefaultColor)`). R134 removed `AssetParseDefaultColor` and builds it in `AssetAssignDefaultColor(A)` **only from each layer's `Color`** (`Layer.Color`, parsed by `AssetParseLayerColor`). An asset-level `DefaultColor` is not read at all. Vanilla assets were converted to per-layer colours; Echo's definitions still use `DefaultColor: [...]` on the asset.

Measured with Echo loaded: 1,935 of 2,276 Echo assets have an all-`Default` colour list on R134, against 1,512 on R133.

Note: the mod adds assets with `invokeOriginal("AssetAdd", ...)`, so a ModSDK hook on `AssetAdd` never sees them. `AssetAdd` still calls `AssetMapLayer(Layer, A, I, AssetDef, GroupDef)` and `AssetAssignDefaultColor(A)` by name, so hooks on those do apply.

### 3. `BaselineProperty.TypeRecord`

`标志纹饰` sets `BaselineProperty: { TypeRecord: { p: 0, a: 1, b: 0, ... } }`. `ExtendedItemSetOption` deletes baseline keys from the previous option's properties (`CommonKeys(data.baselineProperty).forEach(i => delete previousProperty[i])`), so the old `TypeRecord` is never removed. On R133, `PropertyUnion` then merged the new option over it (`{ ...old, ...new }`, new wins). On R134, `ItemPropertiesUnion` keeps the existing value (`ret[k] ??= v`, old wins), so the item can never change options.

### 4. Modular options (game bug)

R134's `PropertyDataEntry.differenceShallowObjects` (`Scripts/Property.js`) stops after the first deleted key (`break innerLoop`). So when an option changes, only the first module is cleared and re-applied, and every later module falls back to option 0. This affects vanilla items too (Bar Stool decal, Hypnotic Visor) and is fixed in the game by bananarama92's MR !6947 (not merged yet). Nothing to change in Echo.

## Fix

Suggested changes on Echo's side:

- **`@sugarch/bc-asset-manager`, `CommonFetch` hook:** when `args[1]` is set, fold its headers into the new `Request` and drop it, e.g.

  ```js
  const [input, options] = e;
  const req = toCorsRequest(input); // the existing mapping
  if (req) {
  	if (options) {
  		const headers = new Headers(req.headers);
  		for (const [k, v] of new Headers(options.headers ?? undefined)) if (!headers.has(k)) headers.set(k, v);
  		e = [new Request(req, { headers })];
  	} else e[0] = req;
  }
  return t(e);
  ```

  This works on R133 too, which never passes options here.
- **Default colours:** either give each layer its colour (`Layer: [{ Name: "A1", Color: ["#0A0A0A"] }, ...]`, the R134 format), or keep the asset-level `DefaultColor` and convert it when the asset is added: hook `AssetMapLayer` (it receives `AssetDef`) and `AssetAssignDefaultColor`, then set `asset.DefaultColor` and each colourable layer's `Color = [DefaultColor[layer.ColorIndex]]`. Skip definitions whose layers already have `Color`.
- **`标志纹饰`:** keep `TypeRecord` out of `BaselineProperty`, or make sure the chosen option is merged over it after `ExtendedItemSetProperty` (before the refresh/push).

Until Echo updates, **ER - Extension Repairer** (https://github.com/Proudkiller0015/extension-repairer, MIT) applies these as stopgaps for players. Each fix checks the game first and switches itself off when the game or the mod no longer needs it:

| ER fix | What it does |
|---|---|
| `fetch-request` | `CommonFetch` hook at priority -1000 (after Echo's): folds the options into the `Request` |
| `default-color` | `AssetMapLayer` + `AssetAssignDefaultColor` hooks: restores the asset-level `DefaultColor` for definitions without layer colours |
| `baseline-options` | `ExtendedItemSetProperty` hook: merges the chosen `TypeRecord` over the old one before the refresh, like R133 |
| `modular-options` | MR !6947's `differenceShallowObjects` / `ItemPropertiesDifference`, only while the game still has the bug |

## Testing

Headless Chrome against the live R133 build and the R134 beta, loading Echo's FUSAM sources (`bc-cloth.js`, `bc-activity.js`):

- **Every Echo item with options** (modular and typed): set a non-default option in every module, bundle the appearance, load it on a second character, and compare.

  | Build | Options kept |
  |---|---|
  | R133 | 568 / 570 |
  | R134 beta | 402 / 571 |
  | R134 beta + ER | 569 / 571 |

  The remaining two (`DroneMask` module `j`, `宠物箱` module `c`) fail the same way on R133, from the items' own option rules.
- **A real look** (exported with WCE `/exportlooks` on R133, 41 items, `BodyStyle` `EchoV2`), drawn on each build: R133 draws hair, eyes, sleeves and cape. The R134 beta draws none of them. The R134 beta with the `CommonFetch` fix draws the same as R133. With the fix, all cached Echo images are `loaded`, against `failed` without it.
- `淫纹` (3 groups) draws without errors once the default colours are restored.
- On R133 none of these fixes activate, and the results are unchanged.

## 中文摘要

在 R134 测试版（`R134Beta1`）中，服装拓展能加载并注册物品，但有以下问题：

1. **大部分图片无法加载（头发、眼睛、广袖、披肩等全部不显示）。** R134 的新图片加载器调用 `CommonFetch(url, { headers })`，而 R134 的 `CommonFetch` 在收到 `Request` 对象的同时又收到 options 时会直接抛出 `can't use options and pass a request object`。`@sugarch/bc-asset-manager` 的 `CommonFetch` hook（`ImgMappingOnce.CommonFetch.cors`）把跨域地址替换成 `new Request(...)`，但保留了第二个参数，所以所有 CDN 图片在发出网络请求前就失败了。建议：有 options 时把其中的 headers 合并进新的 `Request`，并去掉第二个参数（R133 不传 options，不受影响）。
2. **约 420 个物品失去默认颜色。** R134 只从每个图层的 `Color` 读取默认颜色，不再读取物品级的 `DefaultColor`。`淫纹` 因颜色为 `Default` 在绘制渐变时报错。建议：改为图层级 `Color`，或 hook `AssetMapLayer` 与 `AssetAssignDefaultColor` 自行恢复（注意 `invokeOriginal("AssetAdd")` 不会经过 `AssetAdd` 的 hook）。
3. **`标志纹饰` 无法切换选项。** `BaselineProperty` 中包含 `TypeRecord`，旧值不会被删除，而 R134 的合并规则是旧值优先（R133 是新值优先）。建议：不要把 `TypeRecord` 放进 `BaselineProperty`。
4. **模块化物品只保存第一个模块的选项。** 这是游戏本身的 bug（`differenceShallowObjects` 中的 `break innerLoop`），已由游戏的 MR !6947 修复（尚未合并），服装拓展无需修改。

在服装拓展更新之前，ER - Extension Repairer（https://github.com/Proudkiller0015/extension-repairer ）为玩家临时修复以上问题；每项修复都会先检测游戏，问题不存在时自动停用。测试结果：R133 568/570，R134 测试版 402/571，R134 测试版 + ER 569/571（剩下的两个在 R133 上同样失败）。
