# 小雪交易 · SlowSnowTrade

适用于 Intel Mac、Apple Silicon Mac 和 Windows 的本地加密货币交易练习工作台。三个平台共用图表、交易账本和 Agent 界面。Mac 使用 Clang、Cocoa 和 WebKit，不需要完整 Xcode 或 App Store；最低 macOS 13。Windows 使用 Electron，支持 Windows 10/11 x64。

## 开源与下载

本项目以 [MIT License](LICENSE) 开源，允许使用、修改、分发和商业使用，分发时保留许可证与版权声明。第三方依赖和外部图标遵循各自许可证。

- [GitHub 源码](https://github.com/q3281895433/SlowSnowTrade)
- [1.8.0 安装包](https://github.com/q3281895433/SlowSnowTrade/releases/tag/v1.8.0)：Intel Mac、Apple Silicon Mac、Mac 通用版及 Windows x64。

## 构建与打开

```sh
cd ~/Desktop/VScode/SlowSnowTrade
bash build-mac.sh x86_64
open build/SlowSnowTrade.app
# M 芯片版：bash scripts/package-mac.sh arm64
# Intel 与 M 芯片通用版：bash scripts/package-mac.sh universal
```

现成安装包统一整理在桌面 `安装包/SlowSnowTrade/`，Mac 与 Windows 分目录保存；本项目 `release/` 为构建临时输出目录。Mac 安装：打开对应 `.dmg`，把带小雪人图标的 SlowSnowTrade 拖入 Applications。通用版包含 Intel 与 arm64 两种架构，可用于两种 Mac。编译只需要 Apple Command Line Tools。请从 Applications 中启动；右键程序坞图标，选择“选项 → 在程序坞中保留”。不要把临时 DMG 内的 App 路径固定到程序坞。

Windows 下载 `SlowSnowTrade-1.8.0-Windows-x64-Setup.exe`，安装向导可选择目录，并创建桌面和开始菜单快捷方式；在系统“已安装的应用”中可卸载。交易、图表设置和复盘数据在卸载后保留。

本项目暂未配置 Apple Developer ID、公证或 Windows 商业代码签名证书。Mac 首次打开可能需要在“隐私与安全性”确认，Windows 可能显示 SmartScreen 提示；不要全局关闭系统防护。

## Windows 开发与自动打包

```sh
npm ci
npm start
npm run dist:win
```

在 Windows 上运行上述命令，不需要 Xcode。`packaging/AppIcon.ico` 含 16–256 像素的现有小雪人图标，覆盖快捷方式、安装程序、卸载程序和任务栏。修改 PNG 后可在 Mac 用 `python3 scripts/make-windows-icon.py` 重新生成 ICO。

GitHub Actions 的 **Desktop installers** 工作流会在 Windows runner 上生成 `.exe`，并在 Mac runner 上生成 Intel、M 芯片和通用 `.dmg`。在仓库 Actions 页面打开成功的任务，从 Artifacts 下载对应平台的压缩包后解压安装。也可以点击 Run workflow 手动构建。它只编译和打包，不启动交易 App，不调用 DeepSeek，不读取本地账户数据。

平台入口：`SlowSnowTrade/Native/main.m` 为 Mac 原生入口；`SlowSnowTrade/Desktop/main.cjs` / `preload.cjs` / `service.cjs` 为 Windows 桌面与网络存储层。窗口隔离并仅开放必要的消息接口，交易接口始终是本地模拟记账。

## 功能

- 原生网络层支持 Binance 与 Bitget 公开现货 K 线和 WebSocket 行情；“自动择快”并发请求两家，使用首先返回有效 K 线的行情源。也可在顶部手动切换。
- “发现更多币种”窗口读取当前行情源的完整 USDT 交易列表，支持名称/交易对搜索、分页、最新价格/24 小时涨跌幅、种子标签筛选和星标自选，按 24 小时成交额自动加入热门币种。种子标签取自币安公开产品数据中的 `Seed` 字段，在其他行情源中仅给同名交易对显示该来源标签；显示更新或缓存时间，不推断未提供标签的币种。公开图标缺失时显示符号。
- K 线周期：1/3/5/15/30 分钟、1/4/6/12 小时、日线、2 日、周线。2 日按 UTC 的连续两日分组，周线从 UTC 周一开始，由同一行情源的日线合成开、高、低、收和成交量；实时日线更新会重新计算当前区间，避免成交量重复累加。历史请求最多读取 1000 根日线；不把下载窗口开头缺少日线的已结束区间当成完整 K 线。Agent 使用同样的周期合成规则，并记录原始日线来源。周期工具栏可横向滚动。
- K 线滚轮缩放（蜡烛宽度 2–50 像素）；下方独立滑轮向左浏览历史、向右回到最新，并允许把行情拉过最新 K 线。鼠标十字准星使用独立画布同步绘制。左键默认单击一次开始趋势线，再单击终点确认；按时间方向递增采用深蓝色，递减采用深红色。可从工具栏切换标记、买点、卖点或测量模式；测量模式点击两根蜡烛可查看涨跌幅与根数，双击或 Esc 清除。
- **箱体：**左键保持约 0.15 秒，再拖动并松开即可画箱体。箱体不会额外产生短按标记，跟随时间和价格坐标保存。右键箱体内部时，菜单同时保留划线工具和“取消此箱体”；重叠箱体优先取消最上面的一个。
- 右键菜单可设置水平线、趋势线和买卖点。水平虚线右键开始、左键确认终点，线宽 0.8 像素，相对所选仓位开仓价（无仓位则为合约最新价）上方为深绿色、下方为深黄色。趋势线也可用右键位置为起点，左键点击终点；附近已有线可修改颜色、粗细、名称和实虚线。买卖点标记不执行交易，开平仓会自动生成成交标记。
- **止盈止损：**先在当前持仓表单击账单，右键选择“设置所选账单止盈止损”；自动识别多空，以该账单开仓价为中间线、右键位置为时间起点。左键确认横线终点 → 移动到盈利方向并单击确认绿色止盈线 → 移动到亏损方向并单击确认红色止损线。多仓止盈在中间线上方、止损在下方；空仓相反。止损阶段在止盈侧单击无效，红色预览可以移动到任意一侧。三条线等长、细实线，止盈采用绿色、止损采用红色半透明填充（18% 不透明度），填充位于 K 线下层，横向终点仅用于展示，实际触发只判断合约最新价格是否达到止盈/止损价格。右键两个区间任意内部位置，可同时取消该单的止盈和止损。独立做多/做空标注采用相同三步流程，不绑定账单，也不触发交易。Esc 取消未完成绘图。
- 主图均线 MA 20/50/100 分别为绿色、黄色、红色，可同时叠加 EMA 12/26、BOLL、VWAP。“主图曲线”中可输入 `60`、`M60` 或 `MA60` 添加自定义简单均线，周期为 1–1000 根当前周期的 K 线；多个自定义周期可同时勾选、取消和删除，列表及勾选状态随账户界面配置保存。已有周期直接启用，不重复添加；可用 K 线不足所选周期时不绘制该均线。自定义曲线使用按周期固定的颜色。主图曲线和副图指标菜单采用独立浮层，自动避开屏幕边缘并在内部滚动，避免被缩放后的图表窗口裁切；支持 Tab 和 Esc。
- MACD、RSI、KDJ、ATR、CCI、OBV、成交量可同时勾选，按勾选顺序紧贴 K 线下方排列，重新勾选放在末尾。主图和副图用实线分隔，副图之间用虚线；副图有独立竖向滚动栏，主副图间分隔线可拖动调整指标区域高度。
- 持仓、委托、历史、资金与训练记录共用紧凑表格，收窄列间距与左右留白，按记录类型分配列宽；列宽随字号扩展，表头和内容在同一滚动面上。下方独立“左右”滑杆控制整张表横向移动；滑杆和位置文字保持固定尺寸，支持鼠标、触控板和键盘滚动。
- 市场、K 线、交易台、Agent、交易记录和发现币种是六个可拖动、缩放、最小化和最大化的窗口，排列会保存。字号和图标大小各有独立滑杆，滑杆自身尺寸固定。界面按提供的视频改为炭黑、白字与浅绿色状态点，采用圆角输入框和可减少动态的淡入/滑动动画；轻提示音可在顶部关闭。音效为合成提示音，并非视频原音轨。
- **欧易式合约下单结构：**开仓 / 平仓、逐仓、杠杆、限价 / 市价、USDT 价格、币种数量、可用比例滑杆和 25/50/75/100% 快捷比例，双按钮买入开多 / 卖出开空（平仓模式为买入平空 / 卖出平多）。由数量 × 价格计算委托价值，自动计算保证金、费用和强平价。限价挂单冻结对应资金；盘口满足限价或更优价格时成交，撤单退还冻结资金。已提交的限价委托持续跟踪对应币种，不依赖当前打开的图表。持仓表的“平仓”按钮直接按当前合约买卖盘口全部市价平仓，并取消该单剩余的平仓委托；行情刷新保留按钮节点，报价过期会提示并刷新行情。交易台平仓模式自动填入可平数量，仍可指定部分数量或限价，已占用的限价平仓数量从可平数量扣除。价格/数量与账单采用本地模拟记账。
- **保证金接口：**持仓表“保证金”可追加或减少逐仓保证金，减少后不能低于维持保证金和手续费要求。`PTTrade.adjustMargin(account, id, delta, markPrice)` 为账本接口；运行中的 `PTAccountAPI.addMargin(id, amount)` 使用新鲜标记价，调整后保存、记录训练事件和刷新界面，便于后期对接 Agent。正数为追加，负数为减少。
- 本地逐单保证金、多空、逐单盈亏与回报率。每单按逐仓模型独立计算；杠杆为 1–100 倍，同时受该合约和仓位档位允许的上限限制。可以自行加入或减去 USDT。
- **自动强平：**后台约每秒读取 Bitget U 本位合约公开标记价、盘口买卖价；读取并缓存真实仓位档位及吃单费率。浮动盈亏按合约标记价计算，开平仓按合约买卖报价估算。现货 K 线可以继续选 Binance 或 Bitget，交易台另显示合约标记价。未获取有效合约行情和档位，或报价超过 5 秒未更新时，不允许新开仓。
- 逐仓保证金权益 = 当前保证金 + 标记价未实现盈亏；权益不足以覆盖分档维持保证金及预留平仓手续费时自动进入强平。大仓位先按下一档限额减仓并重新评估；仍不安全则继续降档，第一档或保证金不足时按破产价接管清算。极端跳价的穿仓部分记录为保险承担，不扣用其他仓位或可用余额。没有手动爆仓按钮。
- 历史和训练样本记录强平触发标记价、当时权益、维持保证金、档位、减仓或接管清算结果；启用自动复盘时交给 DeepSeek 分析。
- **策略复盘 Agent：**复盘输出核心判断、入场/持仓/退出诊断、3 条具体改进建议、当前技术动向、2 个条件式策略、2 种参考交易方法，以及下次交易清单和量化研究假设。建议包含判断依据、下一步操作和衡量方式；策略包含确认信号、入场、止损、止盈、失效及观望条件。
- Agent 读取对应币种开仓前/平仓时的 Bitget U 本位合约 K 线、当前分析周期/1 小时/4 小时 K 线及 BTC 1 小时背景，计算 MA20/50/100、EMA、MACD、RSI、ATR、BOLL、相对成交量和候选区间。开仓复盘仅使用当时已收盘 K 线，当前行情分开分析，缺少数据时要求说明缺口。价格与成交量动向不包含新闻或链上资金流。长持仓超出单页历史覆盖时，不声称完整盘中路径或精确回测。
- 1.8.0 起使用 DeepSeek Pro 最高思考与流式输出，整体请求最长 15 分钟；输出长度使用模型默认上限，缺失/截断输出会在界面提示。提供“重新生成所选复盘”，旧版本同步归档到 `tradelog/analysis-history/`，原始指标、行情样本及模型/提示词版本与新报告一起保存，供后续量化研究。请求会调用用户配置的 DeepSeek API；不会在升级时批量重生成历史复盘。
- Williams Fractals 可在“主图曲线”中勾选，与均线共存。采用严格五根结构，中间最高/最低价必须严格高于/低于左右各两根；右侧两根已收盘后才在中心 K 线上绘制小三角，不显示未确认候选。定义参考 [TradingView Williams Fractal](https://www.tradingview.com/support/solutions/43000591663-williams-fractal-indicator/)。
- 主图价格范围在最高、最低价外各增加 20% 波动幅度的留白，让蜡烛与买卖标签离上下边缘更远。
- **买卖路标：**买入采用绿色 B 标签，放在 K 线下方并向上指；卖出采用红色 S 标签，放在上方并向下指。图中仅显示固定 18 像素的 B / S 小标签；开多/开空/平多/平空/减仓/强平、笔数、时间、成交价和数量在悬停时显示。邻近同方向成交汇总，避免重叠；分批平仓只保留一条原始开仓标记。手动买卖点采用虚线边框。
- DeepSeek 复盘：API Key 在 Mac 存入钥匙串，在 Windows 使用 DPAPI 系统加密；手动分析历史交易，或开启平仓后自动复盘。Agent 窗口“已保存复盘”可选择查看，启动时自动补读原有 `analysis-*.json`。新旧复盘会同步至桌面 VScode 项目 `tradelog/`，App 内可直接打开该目录。
- 图标为简约卡通小雪人：天蓝色围巾、腮红、K 线小牌。图标原图在 `SlowSnowTrade/Web/assets/app-icon.png`，生成说明与完整提示词在 `SlowSnowTrade/Design/app-icon-prompt.md`。

## 数据位置

首次启动会把旧版 `~/Desktop/deepseek/PaperTrade/` 的文件复制到新目录，原文件保留。所有账户状态、划线、交易流水、K 线快照和 Agent 复盘保存在 `~/Desktop/deepseek/SlowSnowTrade/`。训练事件使用 `training-data.jsonl`，便于以后制作量化 Agent。

另外自动同步到 `~/Desktop/VScode/SlowSnowTrade/tradelog/`：`tradelog.md` 为可阅读的逐单总结，`trades.json` 为完整历史账单，`analysis-*.json` 为各单 DeepSeek 原始复盘，`training-data.jsonl` 为训练事件镜像。没有复盘的账单会标为“尚未生成复盘”，不会自动补发收费 API 请求。API Key 在 Mac 只存入钥匙串，在 Windows 使用系统 DPAPI 加密后保存在应用数据目录；不写入训练数据或项目文件。

当前版本使用公开现货 K 线与 Bitget 合约行情做本地练习，不连接真实资金账户，也不向交易所发送订单。自动强平遵循逐仓标记价、分档维持保证金和预留手续费的模型；每笔订单独立记账，不合并同方向订单为交易所的净仓位。市价按买卖盘口估算，等待成交的限价按符合限价条件的买卖盘口估算，挂单按公开 maker 费率、立即成交按 taker 费率估算；不推断真实挂单队列与部分撮合。不模拟订单簿深度、真实撮合、资金费率结算、离线期间的价格路径或 ADL。因此它并非交易所完整撮合与清算系统的复刻。App 关闭或行情断开时无法实时强平，重新获得有效标记价后检查仍在持有的仓位。DeepSeek API 调用可能产生费用，自动复盘默认关闭。

止盈止损区间样式参考：[TradingView 做多工具](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/)。

下单结构参考：[欧易基础委托类型](https://www.okx.com/zh-hans/help/x-basic-order-types)、[欧易限价与数量平仓](https://www.okx.com/zh-hans/help/closing-lead-trades-with-limit-order-and-custom-amount)；种子标签参考 [币安 Seed 标签说明](https://www.binance.com/en/academy/glossary/seed-tag)。

规则与接口依据：[Bitget 强制平仓机制](https://www.bitget.com/zh-CN/support/articles/12560603895826)、[合约公开行情与费率](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market)、[仓位档位](https://www.bitget.com/docs/catalog/classic-contract-position/classic-contract-position)。分档速算额按各档起始名义价值与维持保证金率差累计计算；接管清算不另收接管手续费。

币种图标使用 [Cryptocurrency Icons](https://github.com/spothq/cryptocurrency-icons) 的公开 CC0 图标，网络不可用时会显示本地符号。

复盘提示词可在 `SlowSnowTrade/Agent/review-system-prompt.txt` 编辑，再运行构建脚本生效。下单标记位置参考 [欧易 K 线下单与买卖记录说明](https://www.okx.com/zh-hans/learn/placing-function-cn)；分析用历史及当前 K 线参考 [Bitget 市场行情数据](https://www.bitget.com/zh-CN/docs/catalog/market/market-data)，生成参数参考 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。

Mac 程序坞操作参考：[Apple 程序坞说明](https://support.apple.com/en-gb/guide/mac-help/mh35859/26/mac/26)。

## 1.7.0 Agent 与安装

从 DMG 或 App Translocation 启动会提供“安装并打开”，把 App 复制到 `/Applications`（无写入权限时使用 `~/Applications`）、固定程序坞并启动安装副本。应用菜单也有“固定到程序坞”。保持原有 bundle ID 与钥匙串服务，账户与密钥继续沿用。

Key 保存成功后收成“API 已配置 / 更换”小框；不会在界面、源码或对话日志展示真实密钥。顶部“问 Agent”或 Agent 内“提问”页可多轮问答，支持 Enter 发送、Shift+Enter 换行；可选择是否附带当前现货图表、确认分形、当前币种持仓与有效合约报价。1.7.0 版本助手只提供分析；1.8.0 起接入本地模拟账户执行工具。请求遵循 [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。

对话保存至桌面 `deepseek/SlowSnowTrade/agent-chat.json`，同步导出到 `VScode/SlowSnowTrade/tradelog/agent-chat.md`；保留最近 200 轮，本次提问使用最近 6 轮上下文。交易复盘仍在“交易复盘”页。只有用户发送问题才调用问答 API；此改动的开发过程中没有读取密钥或发起付费 Agent 请求。

## 1.7.1 止盈止损

- 合约 ticker 实时流检查止盈止损，REST 作为重连期间的回退。旧持仓缺少档位时仍检查止盈止损；强平使用已加载的合约档位。
- 未绑定持仓的区间完成后询问是否市价开仓；取消只保留标注。确认时校验实时成交价、数量、杠杆与两个保护价，成功开仓后同时绑定。
- 绘图区间时滚轮同时缩放时间与价格，Shift + 滚轮只缩放价格，已确认的价位和端点保持不变。
- 止盈止损按 Bitget 合约最新成交价触发并以当时盘口成交；现货图表影线可能不同。应用关闭或行情断线期间无法持续执行，重连后按最新有效报价检查。

## 1.7.2 USDT 成交额输入

下单区和区间开仓确认都可直接输入 USDT 成交额，按委托价或对应方向的实时盘口换算币数，并按合约数量精度向下取整。也可输入币数量，自动显示对应 USDT 金额。保证金按成交额除以杠杆计算，手续费另计。

待成交限价按输入价格换算；市价及可即时成交的限价单提交时按最新买卖盘口重新换算。USDT 金额输入期间保持目标金额，报价变化时仅更新预计币数。切换币种、持仓或开平仓模式会清空本次输入。

## 1.8.0 模拟交易 Agent

- 提问和复盘均使用 `deepseek-v4-pro`、`thinking.enabled`、`reasoning_effort=max` 与 SSE 流式输出。思考阶段显示状态，回答逐段出现；工具续接保留模型要求的 reasoning_content。参数依据 [DeepSeek 官方文档](https://api-docs.deepseek.com/api/create-chat-completion/)。最高思考可能比普通分析耗时更长。
- Agent 可读取账户、公开 Bitget 合约行情（当前周期、1h、4h 与 BTC 背景）、已平仓记录和本地训练样本；可实际在本地模拟器开仓、限价委托、平仓、减仓、撤单、修改止盈止损、调整保证金。只设置止盈止损不会无持仓开仓。没有真实交易所下单接口。
- 勾选“允许执行模拟交易”后，必须在本轮明确发出执行请求；咨询类提问只开放读取工具。“停止”取消模型请求并阻止后续账户操作，已执行的成交不会回滚。断流或不完整工具指令不执行；同轮重复变更拦截，最多8轮工具交互、6项账户变更。
- 例如：“用成交额10USDT，在当前币种开多，杠杆5倍。”也可指定限价、止盈止损；仅说10U默认成交额，明确说保证金才按保证金换算。真实模拟成交数量按合约精度向下取整，不会擅自扩大预算。
- 工具请求和结果存入 `training-data.jsonl`；对话与工具摘要存入 `agent-chat.json`，导出到桌面 `VScode/SlowSnowTrade/tradelog/agent-chat.md`。读取样本用于本轮研究，不代表已训练或回测量化模型。
- 需要有效 DeepSeek Key、余额与模型访问权限；行情和模型服务需联网。应用打开且行情正常时检查保护价与强平，不提供后台常驻或离线撮合。
