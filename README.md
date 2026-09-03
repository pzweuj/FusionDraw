# FusionDraw

[English README](README_EN.md) · 中文

FusionDraw 是一个面向浏览器的融合基因图示引擎。它将注释查询与图形渲染解耦：GTF 数据先编译为静态注释包，渲染器只消费已经解析完成的 `FusionPlotSpec`。

项目用于生成融合基因的科研示意图和报告插图，不用于临床诊断。

## 项目地址

- GitHub 仓库：[pzweuj/FusionDraw](https://github.com/pzweuj/FusionDraw)
- 部署地址：[https://fusiondraw.biotools.space](https://fusiondraw.biotools.space)

## 开发

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
```

启动 `pnpm dev` 后，Vite 会打印实际访问地址。如果默认的 5173 端口被占用，Vite 会尝试下一个可用端口。开发服务同时提供 `POST /api/render-svg` 接口。

## SVG 生图 API

### 地址

计划中的生产 API 地址为：

```text
POST https://fusiondraw.biotools.space/api/render-svg
```

本地开发时使用：

```text
POST http://127.0.0.1:5173/api/render-svg
```

如果 Vite 使用了其他端口，请以终端打印的地址为准。API 接收完整的 `FusionPlotSpec` JSON，并返回 `image/svg+xml`。

### 最小请求

下面是一个不包含基因组坐标的最小请求。它适合抽象示意图；真实融合结构应提供实际保留的外显子段：

```json
{
  "specVersion": "0.1",
  "coordinateSystem": "1-based-inclusive",
  "locale": "en",
  "fivePrime": {
    "gene": { "symbol": "A" },
    "transcript": { "exons": [{ "label": "1" }] }
  },
  "threePrime": {
    "gene": { "symbol": "B" },
    "transcript": { "exons": [{ "label": "1" }] }
  },
  "fusion": {
    "name": "A::B",
    "fivePrimeExons": [{ "label": "1" }],
    "threePrimeExons": [{ "label": "1" }]
  },
  "chromosomeView": { "show": false }
}
```

### 请求字段

- 顶层必须包含 `specVersion: "0.1"`、`coordinateSystem: "1-based-inclusive"`、`locale`（`en` 或 `zh-CN`）、`fivePrime`、`threePrime` 和 `fusion`。
- 每个伙伴必须包含基因符号，以及带有 `exons` 数组的 `transcript`。
- `fusion.fivePrimeExons` 和 `fusion.threePrimeExons` 表示融合后保留的外显子段。表示真实外显子范围时，应为每个外显子使用一个对象，不要只写一个 `1-13` 范围字符串。
- 如果要显示染色体/基因组视图，需要为每个伙伴提供 `assembly`、染色体、1-based inclusive 的断点坐标和链方向；如果提供 `resolution`，还需要完整且相互一致的转录本编号、外显子/内含子编号等字段。

### 调用示例

```powershell
curl.exe -X POST https://fusiondraw.biotools.space/api/render-svg `
  -H "Content-Type: application/json" `
  --data-binary "@fusiondraw.json" `
  -o fusiondraw.svg
```

本地测试时，将命令中的生产域名替换为当前开发服务地址即可。

接口响应约定：

- 有效 PlotSpec 返回 `200` 和 `image/svg+xml`。
- 无效 PlotSpec 返回 `400` 和包含 `error` 字段的 JSON。
- 浏览器 CORS 预检使用 `OPTIONS`，返回 `204`。
- 其他 HTTP 方法返回 `405`，允许的方法为 `POST, OPTIONS`。

## Agent 技能

项目内的 [FusionDraw SVG 技能](skills/fusiondraw-svg/SKILL.md)用于让 Agent 根据用户提供的绘图信息生成 SVG。

Agent 应当：

- 明确区分 5′ 伙伴（`fivePrime`）和 3′ 伙伴（`threePrime`）的顺序。
- 在示意图请求中，至少收集两个伙伴的基因符号和两侧保留的融合外显子段。
- 如果信息不完整，先一次性提出针对性的补充问题，再调用 API；不能仅凭融合名称擅自猜测转录本、外显子范围或基因组坐标。
- 如果用户没有真实生物学数据，可以先询问是否接受使用占位外显子生成抽象示意图，并明确说明其限制。
- 如果用户要求真实基因组视图，补充收集 assembly、染色体、断点坐标、链方向和必要的转录本/resolution 信息。
- 优先使用计划生产地址 `https://fusiondraw.biotools.space`；用户指定地址优先，生产地址不可用且任务允许本地开发时再使用本地 Vite 地址。
- 成功返回 SVG 后，按用户要求直接返回或保存为 `.svg` 文件；不要将 SVG 误称为 PNG/JPG，也不要将其解释为临床诊断。

技能也可以显式调用：

```text
$fusiondraw-svg
```

## 项目测试

```bash
pnpm test
```

该命令会运行 TypeScript 测试，以及注释编译器的 Python 确定性和标签测试。

## 注释与编辑能力

- Demo 自带小型 hg38 和 hg19 fixture，因此无需后端即可完成 Automatic → Advanced → SVG 流程。
- 生产注释包由 `annotation-builder/build_annotation.py` 生成，发布时应通过 manifest checksum 进行版本管理。
- 编译器生成的注释包会记录每个 shard 的 SHA-256。静态注释提供器使用 manifest checksum 作为 Cache API 命名空间，并在使用前验证 shard，避免过期或损坏的缓存响应进入绘图。
- `applyPlotExonEdit` 将生物学坐标编辑与标签、宽度、可见性等视觉编辑分离。清除任一坐标时会显式清除坐标对，不会自动回退到原始外显子。
- Automatic 解析遇到注释错误时会终止并返回 `errors`，不返回 `data`；调用方可以明确选择手动 PlotSpec。
- 提供器可以通过 `getMetadata` 暴露固定版本信息，解析器会将来源、注释版本和注释包 checksum 写入 `PlotSpec.provenance`。
- 可编辑融合外显子独立存储于源转录本之外：生物学编辑位于 `exon.biological`，标签/宽度/可见性编辑位于 `exon.visual`。
- 断点坐标采用 1-based inclusive。断点位于外显子内部并进行切分时，5′ 段保留断点所在碱基，3′ 段从转录方向上的下一个碱基开始，避免重复覆盖。

FusionDraw 仅用于科研和报告示意，不用于临床诊断。
