# Agent Note: popupSelect 卡片按内容而非 composer 卡片宽度自适应

Status: implemented

[English](2026-08-13-popup-select-content-width.md) | 中文

## Problem

popupSelect 外壳（`PopupSelectView` —— 弹出式命令如 `/model` 背后的 overlay）过去把卡片宽度对齐到 composer 卡片，而不是其内容。卡片是 `position: absolute; left: 0`，锚定在 `conversation.input.overlay` 锚点上，而该锚点恰好就是 composer 卡片的宽度。`PopupSelectView.module.css` 里两行将宽度钉在那里：

```css
min-width: min(220px, 100%);
max-width: 100%; /* never wider than the composer card; long rows truncate */
```

由于 `100%` 相对锚点（composer 卡片）解析，卡片永远无法超过 composer 卡片的宽度。比它更宽的模型名与 detail 行 —— 如 `deepseek-v4-rlasn` 这类长 id 紧挨着 provider/description 说明 —— 命中 `text-overflow: ellipsis` 而被截断显示，正是用户报告的在 `/model` 弹出框中看到 `…` 的成因。

## Decision

卡片保留 shrink-to-fit 宽度，但把 composer 卡片约束替换为 viewport-fit 约束。CSS 中移除 `max-width: 100%`（卡片是绝对定位且无 `width`，本就按最宽行 shrink-fit），并用一个与既有 `useAnchoredMaxHeight` 对称的兄弟 hook 把设计上限限制在视口内：

- `packages/client/ui-primitives/src/useAnchoredMaxWidth.ts` —— `useAnchoredMaxWidth(ref, cap, signal)` 测量卡片左缘到视口右缘之间的空间（减去 12px 门户边距），返回 `min(cap, 该值)` 作为行内 `max-width`。
- `PopupSelectView` 同时应用两个行内约束：`style={{ maxHeight, maxWidth }}`，其中 `MAX_HEIGHT = 320`（不变）、`MAX_WIDTH = 520`。

被删注释中的设计意图 —— “长行被截断而不把卡片推出 composer 边缘” —— 得以保留，但边界从 composer 卡片移到屏幕：长模型名/说明现在会撑大卡片并完整显示，同时右缘仍然不会离开视口。该 hook 复刻 `useAnchoredMaxHeight` 的契约（设计上限作为初始值、由 `signal` 驱动的重新测量、resize 监听），因此两个 overlay 挂载点保持同一套 viewport-fit 家族行为。

## Alternatives considered

**保持一个更宽的固定宽度（如 `min-width: 320px`）。** 可预测，但猜一个既不适合长名称也不适合窄视口的宽度；因更倾向内容驱动而被否决。

**在 CSS 用视口单位（`max-width: calc(100vw - Xpx)`）。** composer 卡片是居中的，其侧向留白未知，因此基于 `100vw` 的上限会按卡片左偏移多出右缘。被否决：viewport fit 需要真实测得的 `left`。

**对斜杠菜单（`MenuView`）应用同样处理。** 斜杠菜单共享 `conversation.input.overlay` 锚点和 `max-width: min(537px, 100%)` 约束，但其行是刻意截断的（`itemName max-width: 40%`、说明 `flex: 1`/ellipsis）。本次改动不包含它。

## Consequences

- `/model` 弹出框（以及任何 popupSelect 命令）按最宽行增长，到 520px 设计上限为止；当锚点在窄屏上位置较低时再对齐到视口；长模型行完整显示而非 `…`。
- `useAnchoredMaxWidth` 成为 `ui-primitives` 的新的公开导出，与 `useAnchoredMaxHeight` 对称，并处于同一 per-file 覆盖率门禁下（由 popup-view 组件 spec 完全覆盖）。
- 斜杠菜单保持其 composer 卡宽度边界与有意的行截断；此处行为不变。
- composer 卡片本身不动；只有浮动 overlay 现在可以超出它。

## Testing

`packages/client/ui-commands/tests/popup-view.client.spec.tsx` 在既有的两个 Geometry 高度约束用例之外新增对应的宽度用例：当锚点右侧有空间时断言 `max-width` 为 `520px`；当卡片靠近右缘时则断言限制到测得的视口空间（`1024 - left - 12`）。`pnpm run test:gui` 覆盖两个改动的包，并通过 keyless replay（`DSH_SNAPSHOT=replay pnpm run test:web`）回放组装后的 web 客户端，以确认整体应用仍能启动并渲染。
