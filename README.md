# crldesk 远程控制软件

一个支持 **客户端之间互相控制** 的远程控制软件。服务端部署在服务器上负责信令与中转，
客户端为跨平台的 Web 应用（Windows / Linux / macOS 浏览器即可运行），并配合原生代理实现
对宿主机的真实鼠标/键盘注入。

支持三种连接方式：

- **IPv4**：局域网/公网 IPv4 地址（如 `http://192.168.1.10:5555`）
- **IPv6**：原生 IPv6 地址（如 `http://[240e:3b2::fa5b]:5555`）
- **FN Connect 域名**：飞牛（fnOS）的 `xxx.myfnas.com` 等域名解析

---

## 架构

```
                画面(JPEG) / 输入(JSON) 经服务端中转
┌──────────────┐                              ┌──────────────┐
│  被控端 Host  │ ◄──────────────────────────► │    服务端     │
│ (共享屏幕 +   │          WebSocket           │  (信令 + 中转 │
│  注入输入)    │                              │  + 管理面板)  │
└──────┬───────┘                              └──────┬───────┘
       │ 本地 WS (127.0.0.1:17900)                   │ 画面(JPEG) / 输入(JSON)
       │ 转发鼠标/键盘事件                           │
┌──────▼───────┐                              ┌──────▼───────┐
│ 原生代理 Agent │                              │  主控端        │
│ Windows/Linux │                              │ Controller   │
│ /macOS 真实注入│                              │ (显示+回传输入)│
└──────────────┘                              └──────────────┘

注：服务端与客户端为**两个独立文件夹/程序**——客户端（`client/web` 或 Electron）单独部署，
在客户端中填写服务端地址（IPv4 / IPv6 / FN Connect 任一）连接。
```

- **服务端** (`server/`)：Node.js（Express + ws），**纯服务端程序，不含客户端**。双栈监听
  IPv4/IPv6，提供 WebSocket 信令（注册/邀请）、**主控端与被控端之间画面与输入的中转**、
  FN Connect 域名解析，以及**服务端管理面板** `/admin`（查看在线客户端、控制会话与流量
  统计，可断开指定客户端）——fnOS（fpk）桌面图标打开的即是该管理页。
- **Web 客户端** (`client/web/`)：独立部署的跨平台 Web 客户端（`client/run-client.bat` 或
  `node serve.js` 托管）。Host 模式捕获屏幕并接收输入；Controller 模式连接对方并显示画面、
  回传鼠标/键盘。画面与输入均经服务端中转。
- **原生代理** (`client/agent/`)：运行在被控机上，把 Web 客户端转发的输入真正注入操作系统
  （被控端不装代理也能用，但输入只会以“叠加光标”形式演示，无法真正操控系统）。

两个文件夹彼此独立，可分别部署到不同机器：

```
crldesk/
├─ server/   # 服务端（装到服务器 / fnOS NAS）
└─ client/   # 客户端（装到每台被控/主控电脑上）
```

---

## 快速开始

### 1. 启动服务端（server 文件夹）

```bat
rem Windows
server\run-server.bat
```
```bash
# Linux / macOS
bash server/start.sh
# 或
cd server && npm install && node server.js
```

默认监听 `::`（双栈）端口 `5555`。可用环境变量覆盖：

- `PORT`：监听端口（默认 5555）
- `HOST`：绑定地址（默认 `::`，即 IPv4+IPv6 双栈；可设为 `0.0.0.0` 仅 IPv4）
- `FN_CONNECT_BASE`：可选，飞牛 FN Connect 解析接口地址
- `FN_CONNECT_DOMAIN`：可选，FN Connect 应用域名。填 FN ID（如 `chenronglin`）会自动补全为
  `crldesk.chenronglin.5ddd.com`；也可直接填完整三级域名。设置后管理面板会显示客户端可填地址
- `PUBLIC_SERVER_URL`：可选，外网客户端实际应填的地址（如 `frp.example.com:12345` 或公网
  IPv6）。设置后管理面板会显示「外网客户端另可填」
- `PUBLIC_IP_PROBE`：设为 `1` 时启用公网出口 IP 探测（默认关闭），管理面板会显示当前公网
  IPv4/IPv6 及更新时间——公网 IP 为动态，仅用于排查，稳定访问请用 DDNS 或 FN Connect 域名

### 2. （被控端）启动原生代理（可选但推荐）

```bat
rem Windows
client\run-agent.bat
```
```bash
cd client/agent && npm install && node agent.js
```

代理仅监听本机 `127.0.0.1:17900`，不暴露到网络。

> 注意：浏览器 `getDisplayMedia`（被控端共享屏幕）属于敏感能力，**仅在 HTTPS 或
> `localhost` 下可用**。若通过局域网 IPv4/IPv6 地址以 `http` 访问，被控端将无法共享屏幕，
> 请为服务端配置 HTTPS（反向代理或自签名证书）后再使用 Host 模式。

平台依赖：

- **Windows**：自带 PowerShell，无需额外安装。
- **Linux**：需 `xdotool`（输入注入）与 `xclip`（剪贴板），`sudo apt install xdotool xclip`。
- **macOS**：需 `cliclick`（输入注入，`brew install cliclick`）；剪贴板用系统自带 `pbcopy`。

### 3. 启动 Web 客户端（client 文件夹，与服务端分开部署）

客户端不再由服务端托管，需单独启动：

```bat
rem Windows
client\run-client.bat
```
```bash
# Linux / macOS（可同时启动 Web 客户端 + 代理）
bash client/start.sh
# 或仅 Web 客户端
cd client/web && node serve.js
```

默认监听端口 `5560`（可用环境变量 `PORT` 覆盖）。浏览器访问 `http://localhost:5560/`，
在「服务端设置」中填入**服务端地址**——**只需填地址，不用带端口**（默认 5555）：

- `<服务器IPv4>`，如 `192.168.1.10`
- `<服务器IPv6>`，如 `240e:3b2::fa5b` 或 `[240e:3b2::fa5b]`
- `<FN Connect域名>`，如 `desk.myfnas.com`（需服务端可被该域名解析到）

若服务端改了端口，可显式写成 `192.168.1.10:8080`。

填好后点「连接」。首次连接成功后地址会被记住，下次自动连接。也可使用 Electron 桌面客户端
（`client/打包exe.bat` 生成的 exe，同样在设置里填服务端地址）。

打开客户端后会自动生成并记住一个 8 位数字**设备码**（只读）与一个 6 位随机**连接密码**（可改为自定义密码）。主界面左右分栏：

- **左栏「本机」**：显示你的「设备码 + 密码」，点「复制」即可发给对方，让对方控制本机。
  对方用正确密码请求控制时，本机会自动弹出屏幕共享选择（无需手动点「接受」）。
- **右栏「远程控制」**：在「对方设备码 + 对方密码」中填入被控端信息，点「连接」，
  密码正确后即可看到对方屏幕并进行鼠标/键盘操作（密码错误会提示）。

提示：把对方 ID 拼到链接后（如 `http://.../?peer=alice`）可自动填充对方设备码。

---

## 三种连接方式说明

| 方式 | 客户端填写 | 说明 |
|------|-----------|------|
| IPv4 | `192.168.1.10` | 局域网/公网 IPv4。需端口可达（防火墙放行 5555，WebSocket 经服务端中转） |
| IPv6 | `240e:3b2::fa5b`（或 `[240e:3b2::fa5b]`） | 原生 IPv6，适合有公网 IPv6 的环境（如家庭宽带） |
| 公网隧道 | `frp.example.com:12345` | 无公网 IP 时，用 frp / 花生壳 / Tailscale 等把 5555 映射出去，填映射后的地址 |

### 关于 FN Connect（飞牛远程访问）

**解析原理**（已实测摸清）：浏览器访问 `http(s)://<FN ID>.5ddd.com` 会 302 跳转到
`https://5ddd.com/<FN ID>/`，该页面（SPA）再调用接口取回本机当前可达地址，即截图里
「检测到 NAS 支持以下访问方式」的数据。crldesk 直接复用同一解析通道拿到**当前**地址：

```
POST https://5ddd.com/api/v1/fn/con   { fnId: "zjhjkj" }
-> { code:0, data:{
      ipv4:["192.168.1.110"],                       // 内网 IPv4
      publicIpv4:["14.122.129.85"],                 // 公网 IPv4
      publicIpv6:["240e:3b2:6623:46e0:..."],        // 公网 IPv6
      ddns:null, fn:["zjhjkj.5ddd.com:443"],        // DDNS / 中继地址
      port:{httpPort:5666, httpsPort:5667}          // 系统端口（不是 crldesk 的 5555）
   }}
```

由此得到的能力：

- **服务端**：设置 `FN_ID=你的FNID` 后，管理面板每 5 分钟解析一次，显示当前公网 IPv6/IPv4、
  内网 IP、DDNS、中继地址；接口 `GET /api/fn-resolve?fnId=xxx` 也可供其他程序查询。
- **Electron 客户端**：「服务端地址」**只填 FN ID**（如 `chenronglin`）即可，主进程发起解析
  （浏览器端受跨域限制无法直接调用），按 公网IPv6 → 公网IPv4 → DDNS → 内网IP 依次尝试，全部
  使用 5555 端口——**公网 IP 是动态的也能连上**。
- **浏览器版客户端**：因接口无 CORS 头，浏览器无法直接解析，请填 IP/域名，或改用 Electron 客户端。

> 注意：该接口为 FN Connect 前端**私有接口**（签名算法逆向自其前端资源），非官方开放 API，
> 可能随飞牛更新失效；失效时仅影响自动解析，手动填 IP/域名不受影响。
> 另外：解析出的公网 IP 要能连上，还需防火墙放行 **5555**（5666/5667 是 fnOS 系统端口）。

FN Connect 有两层地址，用途不同：

| 地址形式 | 示例 | 用途 |
|---|---|---|
| 二级域名（NAS 入口） | `https://chenronglin.5ddd.com:443` | 交互式「选择访问方式」页（中继转发 / 公网 IP 直连），**不能直接给客户端用** |
| 三级域名（应用入口） | `https://crldesk.chenronglin.5ddd.com` | 第三方应用的远程访问入口，**走 443 反代到应用端口 5555**，客户端可直接填 |

- 二级域名访问时会先出现「检测到 NAS 支持以下访问方式」页面（中继 `https://<FNID>.5ddd.com:443`、
  公网 IPv6 `http://[xxxx]:5666`），需要点选后才进入 NAS 桌面（5666/8000/8001 是系统端口）。
- 应用远程访问走**三级域名** `https://<应用名>.<FN ID>.5ddd.com`，由飞牛反代到 manifest 里的
  `service_port`（本应用 5555），因此 **WebSocket `/ws` 也走同一域名的 443**：

  ```
  客户端填：crldesk.chenronglin.5ddd.com     （https 默认 443，不必写端口）
  实际连接：wss://crldesk.chenronglin.5ddd.com:443/ws
  ```

- **前提**：需在 fnOS 中开启该应用的远程访问（应用中心 → crldesk → 应用设置 / FN Connect
  的应用远程访问开关）。未开启时访问会返回 `403`，页面提示「FN Connect 暂无权限访问该服务」。
- 服务端可设置 `FN_CONNECT_DOMAIN`：只填 FN ID（`chenronglin`）会自动补成
  `crldesk.chenronglin.5ddd.com`，也可直接填完整三级域名；管理面板会把它显示为客户端可填地址。

其他外网方式（无 FN Connect 时）：公网 IPv6 直连（客户端填 IPv6 地址，默认 5555，需放行该端口）、
路由器端口转发、frp / 花生壳 / Tailscale 隧道（可把映射地址配置为 `PUBLIC_SERVER_URL`，面板会显示）。

### 公网 IP 是动态的，怎么办

家宽的公网 IPv4/IPv6 会变，客户端不要写死 IP。按推荐顺序：

1. **FN Connect 三级域名**（首选）：`crldesk.<FN ID>.5ddd.com` 固定不变，客户端直接填它（或只填
   FN ID，客户端会自动补全为三级域名并优先走 443）。
2. **DDNS 域名**：fnOS 内置支持腾讯云 / 阿里云 / 华为云 / 花生壳 / DuckDNS，配好后客户端填
   域名即可（默认 5555；若 DDNS 域名后接了 443 反代，填 `https://域名`）。
3. **内网**：给 NAS 设静态 IP（路由器 DHCP 绑定），局域网客户端填该内网 IP。

服务端可选设置 `PUBLIC_IP_PROBE=1`，管理面板会每 5 分钟探测并显示当前公网出口 IP（便于排查，
默认关闭）。

画面与输入均通过**服务端中转**：被控端把屏幕逐帧编码为 JPEG 经服务端转发给主控端，
主控端把鼠标/键盘事件经服务端转发给被控端。不依赖 P2P 打洞，链路简单、稳定。

---

## 目录结构

```
crldesk/
├─ server/                # ===== 服务端（独立程序：信令/中转 + 管理面板） =====
│  ├─ server.js           # 服务端主程序（不含任何客户端代码）
│  ├─ admin.html          # 服务端管理面板（/admin）
│  ├─ package.json / package-lock.json
│  ├─ run-server.bat      # Windows 启动服务端
│  ├─ start.sh            # Linux/macOS 启动服务端
│  ├─ 打包fpk.bat         # Windows 打包 fnOS（飞牛）fpk
│  └─ fnos/               # fpk 打包工程（含 build-fpk.sh、fnpack.exe、版本同步脚本）
│
├─ client/                # ===== 客户端（独立程序：被控端 + 主控端） =====
│  ├─ web/                # 跨平台 Web 客户端（原 client-web）
│  │  ├─ serve.js         # 零依赖静态服务器（node serve.js 启动，默认 5560）
│  │  ├─ index.html
│  │  ├─ css/style.css
│  │  └─ js/{net,host,controller,app}.js
│  ├─ electron/           # Windows 桌面客户端（Electron，可打包 exe）
│  ├─ agent/              # 原生 Host 代理（真实鼠标/键盘注入）
│  │  ├─ agent.js
│  │  ├─ platform/{windows,linux,macos}.js
│  │  └─ package.json
│  ├─ run-client.bat      # Windows 启动 Web 客户端
│  ├─ run-agent.bat       # Windows 启动代理
│  ├─ 打包exe.bat         # 打包 Electron 客户端
│  └─ start.sh            # Linux/macOS 启动 Web 客户端 + 代理
│
├─ .gitignore
└─ README.md
```

---

## 安全说明

- 当前为内网/可信网络下的 MVP 实现，**未包含传输加密与访问控制**。公网部署请务必：
  - 在反向代理（Nginx/Caddy）上启用 HTTPS/WSS；
  - 增加 Token / 房间密码等鉴权（服务端 `register` 流程可扩展）；
  - 仅对可信设备开放。
- 原生代理只监听本机回环地址，输入不会离开被控机。

## 已知限制 / 后续可扩展

- 屏幕捕获依赖浏览器 `getDisplayMedia`，需在 Host 浏览器中手动选择共享源。
- 真实输入注入在被控机运行原生代理时生效；否则仅演示叠加光标。
- 剪贴板已支持双向同步（主控端/被控端均有「同步剪贴板」按钮）；键盘注入目前仅支持 A-Z / 0-9 / 常用功能键，中文等复杂输入请用剪贴板粘贴。
- 画面当前为 JPEG 逐帧中转，可扩展：H.264/WebCodecs 硬件编码降低带宽、文件传输、多显示器选择、移动端客户端。
