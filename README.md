# YIJINTOOL

企业经营优化系统，包含客户、跟进、产品、订单、付款、物流、文件及账号管理。

## 环境要求

- Windows，具有可用的 D 盘。
- PowerShell 7 或更高版本；终端使用 `pwsh`。
- Git，以及本仓库的访问权限。私有仓库的协作者需先接受 GitHub 邀请。
- Docker Desktop，使用 WSL 2 和 Linux 容器。

在 Docker Desktop 的 **Settings → Resources → Advanced** 中，将磁盘数据位置设为 D 盘目录，应用设置并启动 Docker Desktop。数据库镜像和数据卷使用该位置。

项目、Node.js、依赖、缓存、浏览器测试文件、上传文件及日志均放在 D 盘。当前启动脚本面向 Windows，不支持直接在 macOS 或 Linux 上运行。

## 首次运行

在 PowerShell 7 中执行：

```powershell
Set-Location D:\
git clone https://github.com/yeungmingyik/business-optimization-system.git
Set-Location D:\business-optimization-system
./scripts/setup.ps1
. ./scripts/enter-env.ps1
./scripts/start.ps1
```

`setup.ps1` 在缺少 Node.js 时，下载并校验官方 Node.js 24.19.0 Windows 安装包，安装到 `D:\nodejs`；已有目录不会被覆盖。已有 Node.js 必须为 24.19.0 或更高的 24.x 版本。脚本随后安装项目指定的 pnpm 和依赖，并生成本机配置。

`start.ps1` 启动 PostgreSQL、构建项目、执行数据库迁移、初始化老板账号，然后启动前后端。首次下载依赖和数据库镜像需要联网。思源黑体资源已随仓库提供，运行系统无需安装 Python 或系统字体。

启动成功后打开 [本地系统](http://127.0.0.1:5173)。在本机终端查看初始登录信息：

```powershell
Get-Content ./.local/access.json
```

每台电脑首次安装都会生成独立密码。老板登录后，可在账号管理中创建运营账号；运营仅访问本人负责的客户和订单。修改密码后，以新密码为准，初始凭据文件不会自动更新。

`.env`、`.local/access.json` 和本地业务数据不提交 Git。重复运行 `setup.ps1` 不会覆盖已有 `.env`。

## 日常启动、停止与更新

先启动 Docker Desktop，再在项目目录运行：

```powershell
Set-Location D:\business-optimization-system
. ./scripts/enter-env.ps1
./scripts/start.ps1
```

停止前后端及数据库，保留数据库数据：

```powershell
./scripts/stop.ps1
docker compose stop postgres
```

更新前先保存本地代码修改，并备份需要保留的数据库和上传文件，再执行：

```powershell
./scripts/stop.ps1
git pull --ff-only
./scripts/setup.ps1
./scripts/start.ps1
```

`start.ps1` 默认重新构建。代码和依赖均未变化且已成功构建时，可使用 `./scripts/start.ps1 -SkipBuild`。

## 地址与数据位置

| 项目            | 开发环境                       | 测试环境                       |
| --------------- | ------------------------------ | ------------------------------ |
| 网页            | `http://127.0.0.1:5173`        | `http://127.0.0.1:5174`        |
| API             | `http://127.0.0.1:3000/api/v1` | `http://127.0.0.1:3001/api/v1` |
| PostgreSQL 端口 | `54321`                        | `54322`                        |
| 数据库          | `business_dev`                 | `business_test`                |
| Docker 数据卷   | `yijintool_postgres-data`      | `yijintool_postgres-test-data` |
| 上传文件        | `.data/uploads`                | `.data/test-uploads`           |

日志位于 `.artifacts/logs`；测试结果位于 `.artifacts/tests`。表中的相对路径均以项目根目录为起点，数据库卷实际存储在 Docker Desktop 配置的 D 盘虚拟磁盘内。

`127.0.0.1` 仅能在运行系统的电脑上访问。其他人可按本指南克隆并启动各自的本地实例；各实例的账号和业务数据独立。多人通过同一网址使用同一套数据，需要另行部署前端、API 和数据库；仅上传 GitHub 源码或启用 GitHub Pages 无法运行完整系统。

## 开发与测试

首次运行步骤完成后，在项目目录执行。每次打开新终端，先加载项目环境；包管理命令使用项目的 `pnpm.ps1`：

```powershell
. ./scripts/enter-env.ps1
./scripts/pnpm.ps1 env:check
./scripts/pnpm.ps1 check
```

`check` 执行类型检查、构建、领域测试和文件处理测试。API 与浏览器测试另使用独立测试实例：

```powershell
./scripts/pnpm.ps1 exec playwright install chromium
./scripts/start.ps1 -Test -SkipBuild
./scripts/pnpm.ps1 test:api
./scripts/pnpm.ps1 test:e2e
```

Chromium 下载到项目的 `.cache/playwright`。测试会创建测试业务数据，使用 `business_test` 数据库和测试上传目录。

测试结束后停止测试实例：

```powershell
./scripts/stop.ps1 -Test
docker compose --profile test stop postgres-test
```

## 常见启动问题

| 错误或现象                                                                  | 处理方式                                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 无法访问 `127.0.0.1:5173`                                                   | 确认 Docker Desktop 正在运行，再执行 `./scripts/start.ps1`，等待命令返回系统地址。                                               |
| `POWERSHELL_7_REQUIRED`                                                     | 使用 PowerShell 7（`pwsh`）打开终端。                                                                                            |
| `D_DRIVE_REQUIRED` / `D_DRIVE_LINK_REQUIRED`                                | 将项目、Node.js 和 Docker 数据放在 D 盘，目录联接也须指向 D 盘。                                                                 |
| `NODE_INSTALL_DIRECTORY_EXISTS`                                             | 安装目录已有内容。使用符合版本要求的 Node.js，或指定新的 D 盘 Node.js 路径后重新运行 `setup.ps1`。                               |
| `NODE_VERSION_UNSUPPORTED`                                                  | 使用 Node.js 24.19.0 或更高的 24.x 版本。                                                                                        |
| `NODE_CHECKSUM_MISMATCH`                                                    | 删除错误中明确列出的下载文件，然后重新运行 `setup.ps1`。                                                                         |
| `PNPM_SETUP_REQUIRED` / `LOCAL_ENV_REQUIRED`                                | 先运行 `./scripts/setup.ps1`。                                                                                                   |
| `DOCKER_STORAGE_CONFIGURATION_REQUIRED` / `D_DRIVE_DOCKER_STORAGE_REQUIRED` | 在 Docker Desktop 中配置 D 盘磁盘数据位置并应用设置。                                                                            |
| `DATABASE_START_FAILED`                                                     | 确认 Docker Desktop 已启动且使用 Linux 容器，检查命令输出中的 Docker 错误及数据库端口占用。                                      |
| `PORT_IN_USE`                                                               | 检查是否已有实例运行；重启本项目时先执行 `stop.ps1`，测试实例使用 `stop.ps1 -Test`。                                             |
| `APPLICATION_START_FAILED`                                                  | 查看 `.artifacts/logs/development-api-error.log` 和 `.artifacts/logs/development-web-error.log`；测试实例文件名以 `test-` 开头。 |

如需为 Node.js 使用另一个 D 盘目录，在每次新开终端后、执行项目命令前设置当前进程变量。自动安装时，目标 Node.js 目录必须尚不存在：

```powershell
$env:BOS_NODE = 'D:\yijintool-runtime\node\node.exe'
./scripts/setup.ps1
```
