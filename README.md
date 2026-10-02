# 鲸鱼娘的饭碗 · Whale Rice 0.2.2

DeepSeek 真实账户余额桌面挂件。Q 版蓝发鲸鱼娘捧着米饭碗、拿着勺子，头顶牌子显示余额。检测到余额下降时，她会舀饭、送到嘴边，入口时闭眼张嘴，吃完闭嘴，脸上留一粒米。其余姿态保持一致的普通眼神与简单表情。

挂件只显示人物与头顶余额牌，没有下方文字或工具栏。此版本没有演示模式。

## 使用 Windows 便携版

在 [GitHub Releases](https://github.com/yetchill/whalerice/releases) 下载对应平台与 CPU 架构的版本。常见 Windows 电脑使用 `WhaleRice-0.2.2-windows-x64-portable.exe`，直接双击运行；`-setup.exe` 是安装到当前用户目录的安装版。Windows on ARM 使用 arm64 版本。首次启动自动打开设置：粘贴自己的 DeepSeek API Key，或点击“导入文件”选择只包含密钥的 `.txt` / `.key` 文件，然后点击“保存设置”。导入文件后仍需点击保存。

设置里只有两项：

- **挂件大小**：70%–160%，拖动滑块即时调整并自动保存；也可以使用 − / + 按钮每次调整 5%。重启后恢复上次大小。
- **DeepSeek API Key**：密码输入、文件导入、保存。输入框留空会保留已保存的密钥；已保存密钥不会回显。保存成功后，正常退出和重启会自动恢复。

拖动头顶余额牌移动挂件；右键人物或余额牌打开菜单，可进入设置、刷新余额或退出。关闭设置窗口后，挂件继续运行。系统托盘菜单也可以显示鲸鱼娘、打开设置、刷新或退出。

## 余额与饭量

余额来自官方 `GET https://api.deepseek.com/user/balance`，显示账户的总可用余额，包括充值余额与未过期赠金。它是账户余额，不是某一条 API Key 的独立预算。[官方余额接口说明](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)

自动优先显示 CNY；接口没有 CNY 时显示 USD。两个币种不会相加，也不换算汇率。饭量阈值按当前显示币种的金额判断。

保存密钥后立即查询，之后默认每次查询结束约 60 秒再自动刷新。余额下降在下一次查询时触发一次吃饭动画，不逐次追踪每个模型请求。

| 余额 | 米饭图像 |
| --- | --- |
| ≥100 | 满满一碗 |
| 大于 50、低于 100 | 满碗 |
| 10–50（含 50） | 半碗 |
| 大于 0、低于 10 | 薄薄一层 |
| 0 | 空碗 |

饭量通过满碗、半碗、薄层、空碗四张静止图切换；大于 50、低于 100 时使用满碗图，没有连续改变每粒米的数量。吃饭动作使用七个透明 PNG 姿态文件，包括舀起米饭和送到嘴边的中间姿态，按时间顺序直接切换。入口时闭眼张嘴，吃完恢复普通眼神、闭嘴并在脸上留一粒米，短暂停留后回位；总动作约 1.36 秒。动画期间保留当前余额对应的碗与饭量，结束后回到静止图。

**余额查询会消耗额度吗？** 本软件只查询余额，不发起模型推理请求，也不产生模型输入或输出 token。依据官方余额接口用途和当前按模型 token 计费的规则，可以判断这种查询不产生模型调用费用；官方余额文档没有另列余额查询收费项目。[官方计费规则](https://api-docs.deepseek.com/quick_start/pricing/)

## 密钥保存与连接异常

密钥由 Electron 主进程保存和使用，挂件页面拿不到已保存的密钥。Windows、macOS 和具有可用系统密钥库的 Linux 优先使用 Electron `safeStorage` 加密；Linux 没有可用系统密钥库时，使用 AES-256-GCM 本机加密后备，并限制配置目录和文件的访问权限。后备加密依赖当前用户配置目录内的本机密钥文件。

配置保存在系统应用配置目录中的 `whale-rice` 文件夹。界面大小与位置保存在 `settings.json`，加密密钥保存在 `secure/api-key.json`；Linux 本机加密后备还使用 `secure/local.key`。保存会先校验加密结果，写入后再次读回检查。密钥或旧配置读取异常时会保留原文件并阻止覆盖，设置窗口会显示错误。

软件只直连 DeepSeek 查询余额，不采集聊天内容、不调用模型、不记录 API Key 日志，也不使用第三方中转。

网络失败、Key 失效、限流或超时会保留上次成功查询的余额，并在设置中显示连接错误；尚未取得余额时，牌子显示 `—`。查询失败不会把余额改成零。更换 API Key 后重新建立余额基线，首次成功查询不会误触发吃饭动作。

## 从源码运行与构建

安装 Node.js 24 与 pnpm 11，在项目根目录运行：

```sh
pnpm install
pnpm start
```

运行检查：

```sh
pnpm test
```

在目标系统上打包：

```sh
pnpm dist:win     # Windows 便携 EXE / 当前用户安装版 EXE
pnpm dist:mac     # macOS DMG / ZIP
pnpm dist:linux   # Linux AppImage / DEB
```

默认打包当前 CPU 架构。指定架构示例：`pnpm exec electron-builder --mac --arm64 --publish never`。pnpm 的依赖构建白名单已允许 Electron 安装脚本自动下载运行时；无需手动批准依赖脚本。

## GitHub Release 发布

`.github/workflows/build.yml` 使用六个原生 GitHub runner，分别构建 Windows、macOS 和 Linux 的 x64 / arm64 版本。所有构建与单元测试成功之后，单独的发布任务收集 12 个程序包，再生成完整源码 ZIP、逐帧图片 ZIP 和 SHA-256 校验清单，上传完成后公开 Release。安装包名称包含平台、架构和 Windows 的 portable / setup 类型，不会互相覆盖。

| 平台 | 每个架构的程序包 |
| --- | --- |
| Windows x64 / arm64 | `-windows-<架构>-portable.exe`、`-windows-<架构>-setup.exe` |
| macOS x64 / arm64 | `-macos-<架构>.dmg`、`-macos-<架构>.zip` |
| Linux x64 / arm64 | `-linux-<架构>.AppImage`、`-linux-<架构>.deb` |

每个 Release 还包括 `WhaleRice-<版本>-source.zip`（源码、全部图片、依赖锁文件和工作流）、`WhaleRice-<版本>-frames.zip`（11 张运行时透明 PNG、完整生成提示词和 `ASSETS.md`），以及 `SHA256SUMS.txt`。源码 ZIP 只收录项目文件，不包含本机用户配置、API Key、依赖缓存或先前的安装包。

发布时先更新 `package.json` 版本，再提交并推送对应 `v<版本>` 标签，例如 `v0.2.2`，工作流会自动运行。也可以在 GitHub Actions 中手动运行 **Build and publish release**：tag 留空时发布所选分支 `package.json` 对应的版本；填写 tag 时构建那个已存在的版本标签。标签必须与源码版本一致，并且不能指向其他提交。手动发布首次版本时由发布任务创建标签，固定到此次实际构建的提交。

工作流只使用仓库自带的 `GITHUB_TOKEN`；读取和构建任务没有发布权限，仅最后发布任务具有 `contents: write`。不需要个人 token 或第三方中转服务。失败时不会公开一个缺少平台包的新版本，修复后可重新运行工作流。

本地仅生成源码、图片和校验清单：

```sh
node scripts/prepare-release.cjs --archives-only --output release-assets
```

在收集齐全部平台包后，生成完整待发布目录：

```sh
node scripts/prepare-release.cjs --binaries release --output release-assets
```

Linux AppImage 需先赋予执行权限。Linux 桌面环境或 Wayland 合成器可能限制透明窗口、置顶或窗口定位效果。Windows 及 macOS 包没有开发者证书签名或 macOS 公证。

## 验证范围

Windows 的实际 Electron 测试已验证 API Key 保存、正常退出后重启自动恢复，以及已保存密钥不向挂件页面回显。

没有提供真实 API Key，因此尚未验证真实账户余额查询。macOS、Linux 已附运行与构建配置以及 CI 工作流，尚未进行实机验收。

## 素材

角色、饭碗、米饭和勺子都包含在单张生成的透明 PNG 帧中。四张静止饭量图与七个动作姿态文件共包含十张独立生成的图像，其中动作起点 `eat-01.png` 复用 `idle-full.png`。角色是非官方鲸鱼娘风格插画，使用内置 imagegen 生成；素材清单见 [ASSETS.md](ASSETS.md)，每一张独立生成图像的完整提示词见 [assets/frames/generation.json](assets/frames/generation.json)。

社区形象背景参考：[deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan)。本项目为非官方社区桌面挂件。
