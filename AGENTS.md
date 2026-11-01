# AGENTS.md

本仓库的用户脚本按「一脚本一目录」组织。

## 约定

- 每个用户脚本放在根目录下独立的 kebab-case 英文目录中，目录名与 `*.user.js` 文件名一致（如 `baidu-batch-unzip/baidu-batch-unzip.user.js`），**不得直接放在根目录**；`@name` 用中文展示名，与目录名不要求逐字相同。
- 新增脚本：先建目录，再放入 `*.user.js`；脚本说明、资源、示例也放在同一目录内。
- 仓库文件结构发生任何变化（新增 / 删除 / 重命名 / 移动）时，必须同步更新下方目录树。

## 脚本头约束

每个脚本的 `==UserScript==` 头必须满足：

| 字段 | 要求 |
| --- | --- |
| `@author` | `zc` |
| `@name` | 中文展示名，仅限中英文与数字，`^[\u4e00-\u9fa5A-Za-z0-9]{1,12}$` |
| `@namespace` | 单个目标域名取该 `@match` 主机名（`pan.baidu.com` → `pan.baidu.com`）；多个目标域名取共同可注册域（`pan.baidu.com` + `tieba.baidu.com` → `baidu.com`；`a.example.co.uk` + `b.example.co.uk` → `example.co.uk`）；只写域名，不带协议、尾斜杠与路径；无共同可注册域时取主要服务的域名（一般为 `@match` 中排在首位的域名），并在脚本内注释列出其余域名 |
| `@license` | `GPL-3.0-or-later` |
| `@version` | `X.Y.Z`，按改动级别递增（见下） |

- `@match` 域名增减时，必须同步复核 `@namespace`。
- `@namespace` 只是脚本标识的一半，`@name` 与它共同构成唯一键：同一站点可以有多个脚本共用 `pan.baidu.com`，只要 `@name` 不重复；两者任一变化都会被管理器视为新脚本。
- `==/UserScript==` 之后紧跟版权块：`Copyright (C) <年份> zc`、GPL 的「either version 3 or later」授权语句、`SPDX-License-Identifier: GPL-3.0-or-later`。

版本号规则：

- **小修小补**（bug 修复、文案/样式微调）：PATCH +1，如 `5.1.0` → `5.1.1`。
- **功能更新**（新增能力、交互或接口调整）：MINOR +1、PATCH 归零，如 `5.1.1` → `5.2.0`。
- **大跨度升级**（重写、架构或兼容性大改）：MAJOR +1、MINOR 与 PATCH 归零，如 `5.2.0` → `6.0.0`。
- **标识变更**：修改 `@name` 或 `@namespace` 会改变脚本标识，已安装版本收不到更新，至少按「功能更新」处理，并在提交说明中注明需重新安装。

只改 `AGENTS.md`、`LICENSE` 等仓库文件而不动脚本时，不递增脚本版本。

`LICENSE` 为 GPLv3 原文，"or later" 由脚本头的 `@license` 与版权块表达。

## 目录结构

```text
.
├── AGENTS.md
├── LICENSE
└── baidu-batch-unzip/
    └── baidu-batch-unzip.user.js
```
