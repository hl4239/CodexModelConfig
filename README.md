# 纯vibecoding项目
# Codex 模型管理器

一个独立的中文 Windows 桌面应用：读取 Codex 官方内置模型目录，维护自定义模型，合并并让 Codex 加载。运行时无需浏览器，也无需安装 Node.js。

## 启动

双击 **`release/CodexModelConfig-1.0.0-win-x64.exe`**。这是自带运行环境的 Windows x64 便携程序，不需要安装。也可以双击项目根目录的 `start.cmd`，它会优先启动已打包程序。

电脑上需要有支持 `codex debug models --bundled` 的 Codex CLI，通常可以直接检测已安装的 Codex 桌面版。关闭应用窗口即退出。

## 源码开发与打包

仅源码开发需要 **Node.js 22+**。在项目目录执行：

```powershell
npm install
npm run setup:electron
npm start
```

`setup:electron` 下载 Electron 运行环境，适用于 npm 默认阻止依赖安装脚本的环境。应用使用 Electron 独立窗口，内置本机服务仅监听动态回环端口，不会打开浏览器。

```powershell
npm run build
```

输出为 `release/CodexModelConfig-1.0.0-win-x64.exe`；`release/win-unpacked/` 是包含全部运行文件的解包版，也可直接运行其中的 `Codex Model Manager.exe`（需保留整个目录）。

## 使用流程

1. **读取官方目录**：启动时自动执行 `codex debug models --bundled`。Windows 优先查找桌面版附带的 CLI（按修改时间排序），再查找 PATH 中的 `codex.exe`；工具设置中可以指定完整路径。界面显示实际使用的路径和版本。
2. **添加自定义模型**：在官方模型右侧点击 `+`，或点击“添加自定义模型”。设置新的模型 ID，再用表单或高级 JSON 调整能力参数。
3. **检查合并预览**：所有官方条目完整保留；启用的自定义条目按模板追加。模型 ID 必须唯一。可以导出合并 JSON。
4. **应用到 Codex**：点击“应用到 Codex”，检查目标路径并点击“应用并备份”。工具先让 Codex CLI 加载候选目录进行校验，再备份配置并写入合并文件与顶层 `model_catalog_json`。
5. **重启 Codex**：目录在启动时加载。以后升级 Codex，重新刷新、检查和应用即可。

保存、启停、删除模型只更新本工具的配置；需要再次应用，才会更新 Codex 正在引用的合并目录。已经运行的 Codex 不会立即重新加载。

## 继承与更新

每个自定义模型保存官方模板 `baseSlug` 与覆盖字段 `overrides`，不复制固定的整份官方模板。刷新时重新继承未覆盖字段，对象递归合并、数组整体替换。要恢复继承，在高级 JSON 中删除对应键；表单清空对应字段也会删除该覆盖。

```json
{
  "version": 1,
  "models": [
    {
      "slug": "my-custom-model",
      "baseSlug": "gpt-6-sol",
      "enabled": true,
      "overrides": {
        "display_name": "My Custom Model",
        "visibility": "list",
        "supported_in_api": true
      }
    }
  ]
}
```

模板请从当前实际目录选择。模板消失、官方新增模型与自定义 ID 冲突、参数无效等情况会显示错误，并阻止启用该条目和应用。可以先停用问题条目再修复。导入采用追加方式；与当前自定义模型重名时拒绝导入。

## 文件与恢复

桌面应用将数据保存在 `%APPDATA%/Codex Model Manager/data/`。工具设置中会显示实际位置，并提供“打开数据与备份目录”按钮。数据与程序分离，替换或移动便携 exe 不会丢失配置。

| 文件 | 用途 |
| --- | --- |
| `models.custom.json` | 用户维护的模板和覆盖字段 |
| `models.official.json` | 最近成功读取的官方目录快照、版本和时间 |
| `models.merged.json` | 点击应用后生成，Codex 引用的完整目录 |
| `settings.json` | CLI 路径设置 |
| `application.json` | 首次应用前的目录设置与最近应用记录 |
| `backups/` | 每次应用和恢复之前的 `config.toml` 备份 |

默认目标为 `$CODEX_HOME/config.toml`，未设置 `CODEX_HOME` 时使用用户目录下的 `.codex/config.toml`。工具只修改顶层 `model_catalog_json`，保留其他设置、注释、换行及 UTF-8 BOM。无法安全处理的目录字符串格式会报错，例如现有目录路径使用多行 TOML 字符串。

“恢复原目录设置”会还原首次应用前的目录键，同时保留之后对其他配置的修改。每次恢复也会先备份。写入失败会尝试恢复此次写入的文件；如果其他程序同时改了文件，工具会停止覆盖并报告备份位置。原配置不存在时，备份目录用 `.missing` 文件记录；恢复后会留下不含目录设置的配置文件。

**应用后请保留数据目录及 `models.merged.json` 的位置。** 删除应用数据前先恢复原目录设置。配置备份可能包含原有凭据信息，应仅保存在本机。

## 可选开发调试模式

源码还保留网页调试入口（独立桌面版不需要此步骤）：

```powershell
node server.mjs --port 4318 --data-dir "D:\CodexModelData" --codex-home "D:\CodexHome" --cli "C:\path\to\codex.exe" --open
```

- `--port`：默认 4317；设为 0 自动选择空闲端口。
- `--data-dir`：自定义持久数据目录。
- `--codex-home`：独立 Codex 配置目录，适合测试。
- `--cli`：指定 Codex 可执行文件。Windows 使用 `.exe`，不直接执行 `.ps1` / `.cmd` 包装脚本。
- `--open`：打开默认浏览器。

网页调试模式默认使用项目 `data/`，通过 `server.lock` 防止同一数据目录被多进程写入。独立桌面版使用 Electron 单实例机制，重复启动会聚焦已有窗口。开发测试可用环境变量 `MODEL_MANAGER_USER_DATA` 指定独立应用数据目录、`CODEX_HOME` 指定独立 Codex 配置目录。

## 范围与限制

- 官方目录固定来自 `--bundled`，随本机 Codex 版本更新，不请求服务器动态目录。
- `model_catalog_json` 是整个目录的替换入口，因此合并结果包含全部官方条目，包括隐藏模型。
- 工具管理目录，不修改 Provider、接口地址、认证信息或默认模型。当前 Provider 需要能够处理自定义模型 ID；模板能力必须与实际模型兼容。
- 工具修改显示的根 `config.toml`。独立的 Codex profile 文件若覆盖了目录设置，需要检查该 profile。
- 刷新失败时可显示上次快照，但禁止应用，直到重新读取成功。
- 工具使用本机接口、请求令牌与同源检查，不对局域网开放；不会将配置发送到远端。

官方文档：[Codex 配置参考](https://developers.openai.com/codex/config-reference/)（`model_catalog_json`）。

## 验证

```powershell
node --test
```

自动化测试使用独立临时目录，覆盖目录继承、冲突、TOML 保留、并发修改、CLI 校验失败、写入失败回滚、应用恢复及本机 HTTP 接口。同机安装 Codex 时可执行真实 CLI 与 Electron 界面集成验证：

```powershell
node scripts/verify-cli.mjs
npm run verify:desktop
```

验证创建临时 `CODEX_HOME` 和应用数据目录，不会写入日常使用的 Codex 配置。界面验证覆盖搜索、模板编辑、高级 JSON、合并预览、真实应用、停用、恢复、删除及桌面桥接，并保存截图到 `artifacts/`。设置 `MODEL_MANAGER_TEST_EXE` 指向解包版 exe 可验证打包产物。
