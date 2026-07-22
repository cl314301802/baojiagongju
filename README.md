# 忱泽智能 - 报价管理系统

全屋智能家居报价工具，React 前端 + CloudBase 后端。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + Vite 5 + React Router 6 |
| 后端 | 腾讯云 CloudBase（云函数 + 数据库 + 存储） |
| 部署 | Cloudflare Pages（mijia.cc.cd） |

## 功能

- 产品管理：CRUD、图片上传、CSV/XLSX 导入导出
- 报价单：按房间分组、3 项固定服务、折扣、PDF 导出
- 双角色：管理员（chenzezhineng）+ 普通用户（xiaomi）
- 仪表盘统计

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 打开浏览器
http://localhost:3000
```

## 部署

### Cloudflare Pages（推荐）
```bash
npm run build
npx wrangler login
npx wrangler pages deploy ./dist --project-name=quote-tool --branch=main
```

### CloudBase 静态托管
```bash
npm run build
# 通过 CloudBase CLI 或控制台上传 dist/ 目录
```

## CloudBase 环境

- 环境 ID：`chenzezhineng-d9g5u1dt34eb52837`
- 区域：上海（ap-shanghai）
- 云函数：products-manager、quotations-manager、upload-image、export-quotation、import-products

### 登录账号

| 密码 | 角色 | 对应 CloudBase 账号 |
|------|------|-------------------|
| `chenzezhineng` | 管理员 | admin / ChenZe888! |
| `xiaomi` | 普通用户 | xiaochen / XiaoMi666! |

## 项目结构

```
quote-tool/
├── src/
│   ├── App.jsx          # 主应用 + 路由
│   ├── cloudbase.js     # CloudBase SDK 初始化
│   ├── index.css        # 全局样式（深色科技风）
│   └── pages/
│       ├── Login.jsx    # 密码登录页
│       ├── Dashboard.jsx # 仪表盘
│       ├── Products.jsx # 产品管理
│       └── Quotations.jsx # 报价单
├── cloudfunctions/      # 云函数
│   ├── products-manager/
│   ├── quotations-manager/
│   ├── upload-image/
│   ├── export-quotation/
│   └── import-products/
├── public/
│   └── _redirects       # Cloudflare Pages SPA 路由
└── dist/                # 构建产物
```
