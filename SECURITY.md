# 本地凭据与公开源码

仓库和安装包不包含真实 API Key、机器人 Token、账户状态、交易记录或训练数据。`.env`、`tradelog/`、`state.json`、`training-data.jsonl`、复盘文件与密钥文件不提交。

DeepSeek Key 由使用者在 Agent 面板自行输入。Mac 使用系统钥匙串；Windows 使用 Electron safeStorage / Windows DPAPI 加密后保存在应用数据目录。渲染界面不会读取已保存的 Key，只接收“已配置”状态。Key 不写入训练样本或项目文件。系统加密不可用时，Windows 版本拒绝保存明文 Key。

只有分析请求会将已配置的 Key 作为 HTTPS Authorization 请求头发送给 DeepSeek。交易所接口只读取公开行情，不保存交易所账户凭据或执行真实订单。

交易与复盘数据保存在使用者桌面的 `deepseek/SlowSnowTrade`，复盘镜像在 `VScode/SlowSnowTrade/tradelog`。请只分享源码和安装包，不要把这些个人数据目录加入公开仓库。
